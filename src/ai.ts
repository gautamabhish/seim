import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { SeimConfig } from './types';

export class LLMClient {
  private apiKey: string | undefined;
  private provider: string;
  private baseUrl: string;
  private model: string;
  private headers?: Record<string, string>;
  private responsePath?: string;
  private readonly systemPrompt =
    'You are a senior Node.js/Express performance engineer. You optimize code while strictly preserving correctness, authentication, authorization, payment logic, secrets, and business invariants. Do not introduce new external network calls or unsafe constructs.';

  constructor(private config: SeimConfig) {
    this.apiKey = config.ai.apiKey;
    this.baseUrl = config.ai.baseUrl || 'https://api.openai.com/v1/chat/completions';
    this.provider = config.ai.provider || this.detectProvider(this.baseUrl);
    this.model = config.ai.generatorModel || this.defaultModel();
    this.headers = config.ai.headers;
    this.responsePath = config.ai.responsePath || this.defaultResponsePath();
  }

  public async analyzeAndOptimize(sourceCode: string, currentMetrics?: { averageLatency: number; p95: number; p99: number; errorRate: number; requestCount: number }): Promise<{ canOptimize: boolean; reason: string; optimizedCode?: string; pattern?: string }> {
    if (!this.apiKey) return { canOptimize: false, reason: 'AI disabled (no API key)' };
    
    const metricsContext = currentMetrics 
      ? `\nCurrent performance metrics:\n- Request count: ${currentMetrics.requestCount}\n- Average latency: ${currentMetrics.averageLatency}ms\n- P95 latency: ${currentMetrics.p95}ms\n- P99 latency: ${currentMetrics.p99}ms\n- Error rate: ${(currentMetrics.errorRate * 100).toFixed(2)}%`
      : '';

    const prompt = this.buildHolisticAnalysisPrompt(sourceCode, metricsContext);
    const content = await this.chat(this.systemPrompt, prompt);
    return this.parseHolisticAnalysis(content);
  }

  public async optimize(originalSource: string, pattern: string): Promise<string | undefined> {
    if (!this.apiKey) return undefined;
    const prompt = this.buildOptimizePrompt(originalSource, pattern);
    const content = await this.chat(this.systemPrompt, prompt);
    return this.extractCode(content);
  }

  public async review(original: string, optimized: string): Promise<{ pass: boolean; reason?: string }> {
    if (!this.apiKey) return { pass: true, reason: 'AI disabled (no API key)' };
    const prompt = this.buildReviewPrompt(original, optimized);
    const content = await this.chat(this.systemPrompt, prompt);
    return this.parseReview(content);
  }

  private detectProvider(baseUrl: string): string {
    const lower = baseUrl.toLowerCase();
    if (lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('google') || lower.includes('gemini')) return 'google';
    if (lower.includes('x.ai') || lower.includes('grok')) return 'grok';
    return 'openai';
  }

  private defaultModel(): string {
    switch (this.provider) {
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022';
      case 'google':
        return 'gemini-1.5-pro';
      case 'grok':
        return 'grok-2';
      default:
        return 'gpt-4';
    }
  }

  private defaultResponsePath(): string {
    switch (this.provider) {
      case 'google':
        return 'candidates.0.content.parts.0.text';
      default:
        return '';
    }
  }

  private async chat(system: string, user: string): Promise<string> {
    const url = new URL(this.baseUrl);
    const body = this.buildBody(system, user);
    const { options, client } = this.buildRequest(url, body);

    return new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = this.extractText(json);
            resolve(text);
          } catch (e) {
            reject(new Error(`LLM response parse error: ${(e as Error).message}: ${data.slice(0, 200)}`));
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }

  private buildBody(system: string, user: string): string {
    switch (this.provider) {
      case 'anthropic':
        return JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        });
      case 'google': {
        const contents = [
          { role: 'user', parts: [{ text: `${system}\n\n${user}` }] },
        ];
        return JSON.stringify({ contents });
      }
      case 'openai':
      case 'grok':
      case 'custom':
      default:
        return JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
        });
    }
  }

  private buildRequest(url: URL, body: string): { options: https.RequestOptions; client: typeof http | typeof https } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    };

    if (this.provider === 'anthropic') {
      headers['x-api-key'] = this.apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (this.provider === 'google' && this.apiKey) {
      url.searchParams.set('key', this.apiKey);
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (this.headers) {
      Object.assign(headers, this.headers);
    }

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    };

    const client = url.protocol === 'https:' ? https : http;
    return { options, client };
  }

  private extractText(json: any): string {
    if (this.responsePath) {
      return this.getByPath(json, this.responsePath) || '';
    }
    switch (this.provider) {
      case 'anthropic':
        return json.content?.[0]?.text || '';
      case 'google':
        return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      case 'openai':
      case 'grok':
      case 'custom':
      default:
        return json.choices?.[0]?.message?.content || '';
    }
  }

  private getByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, part) => {
      if (current == null) return undefined;
      const match = part.match(/^(.+)\[(\d+)\]$/);
      if (match) {
        const arr = current[match[1]];
        return Array.isArray(arr) ? arr[parseInt(match[2], 10)] : undefined;
      }
      return current[part];
    }, obj);
  }

  private buildOptimizePrompt(source: string, pattern: string): string {
    return `Optimize the following Express route handler for the detected pattern: ${pattern}.

Keep the function signature as an async Express handler (req, res, next). Do not change authentication, authorization, payment logic, business rules, or the response schema. Do not introduce secrets or network calls. Return ONLY the function body inside a JavaScript code block. Do not include explanation.

Original handler:
${source}`;
  }

  private buildHolisticAnalysisPrompt(source: string, metricsContext: string): string {
    return `Analyze the following Express route handler code holistically for performance optimization opportunities.
${metricsContext}

Analyze the code for:
1. Performance bottlenecks (async operations, inefficient loops, blocking operations)
2. Code quality issues (redundant operations, memory leaks, unnecessary computations)
3. Best practices violations (error handling, resource management, security issues)
4. Architectural improvements (caching opportunities, batching, parallelization)

Based on your analysis, determine if the code can be optimized and whether it would provide meaningful performance improvements given the current metrics.

Respond with JSON only:
{
  "canOptimize": true|false,
  "reason": "detailed explanation of your analysis and decision",
  "pattern": "identified pattern type (e.g., 'sequential-async', 'n-plus-one', 'inefficient-loop', 'blocking-op', 'cache-miss', 'redundant-operation', 'none')",
  "optimizedCode": "if canOptimize is true, provide the optimized function body"
}

Original handler code:
${source}`;
  }

  private buildReviewPrompt(original: string, optimized: string): string {
    return `Review whether the optimized Express handler preserves the original behavior and does not introduce security issues. Respond with JSON only:

{"pass": true|false, "reason": "..."}

Original:
${original}

Optimized:
${optimized}`;
  }

  private extractCode(content: string): string | undefined {
    const match = content.match(/```(?:js|javascript|typescript)?\s*([\s\S]*?)\s*```/);
    return match ? match[1].trim() : content.trim();
  }

  private parseReview(content: string): { pass: boolean; reason?: string } {
    try {
      const jsonMatch = content.match(/{[\s\S]*}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return { pass: !!json.pass, reason: json.reason || '' };
      }
    } catch {
      // fall through to heuristic
    }
    const pass = !/\b(fail|incorrect|unsafe|reject|wrong|broken)\b/i.test(content);
    return { pass, reason: content.slice(0, 200) };
  }

  private parseHolisticAnalysis(content: string): { canOptimize: boolean; reason: string; optimizedCode?: string; pattern?: string } {
    try {
      const jsonMatch = content.match(/{[\s\S]*}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          canOptimize: !!json.canOptimize,
          reason: json.reason || 'No reason provided',
          optimizedCode: json.optimizedCode,
          pattern: json.pattern,
        };
      }
    } catch {
      // fall through to heuristic
    }
    
    // Heuristic: if content mentions "already optimal", "no further", etc., assume not optimizable
    const cannotOptimize = /\b(already optimal|no further|cannot be optimized|not worth|minimal impact)\b/i.test(content);
    return {
      canOptimize: !cannotOptimize,
      reason: content.slice(0, 200),
      pattern: undefined,
    };
  }
}
