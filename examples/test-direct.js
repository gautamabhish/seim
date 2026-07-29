const { LLMClient } = require('./dist/ai.js');
const { mergeConfig } = require('./dist/config.js');
const { ValidationEngine } = require('./dist/validation.js');

// Test configuration
const config = mergeConfig({
  ai: {
    generatorModel: 'gemini-2.5-flash',
    reviewerModel: 'gemini-2.5-flash',
    verifierModel: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    enabled: true,
    apiKey: 'AIzaSyC8uqcd4Nnlf69U0sIzCeJLyDwCK8yLxtQ',
    provider: 'google',
  },
});

const llm = new LLMClient(config);
const validation = new ValidationEngine(config, llm);

console.log('Testing direct optimization and validation...\n');

// Test code with sequential async pattern
const originalCode = `
const result1 = await fetchData(1);
const result2 = await fetchData(2);
res.json({ result1, result2 });
`;

const sameOutput = { result1: { id: 1, value: 'data-1' }, result2: { id: 2, value: 'data-2' } };

console.log('1. Testing AI optimization...');
llm.optimize(originalCode, 'sequential-async')
  .then(optimizedCode => {
    console.log('Optimized code:', optimizedCode);
    console.log('\n2. Testing validation...');
    
    // Test validation with same outputs (should pass)
    return validation.validate({
      id: 'test-candidate',
      routeKey: '/test',
      pattern: 'sequential-async',
      severity: 'high',
      originalCode: originalCode,
      optimizedCode: optimizedCode,
      confidence: 0.92,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, sameOutput, sameOutput);
  })
  .then(validationResult => {
    console.log('Validation result:', validationResult);
    console.log('Overall pass:', validationResult.overall);
    console.log('\n3. Testing validation with different outputs (should fail)...');
    
    const differentOutput = { result1: { id: 1, value: 'different' }, result2: { id: 2, value: 'data-2' } };
    
    return validation.validate({
      id: 'test-candidate-2',
      routeKey: '/test',
      pattern: 'sequential-async',
      severity: 'high',
      originalCode: originalCode,
      optimizedCode: 'const [result1, result2] = await Promise.all([fetchData(1), fetchData(2)]); res.json({ result1, result2 });',
      confidence: 0.92,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, sameOutput, differentOutput);
  })
  .then(validationResult => {
    console.log('Validation result:', validationResult);
    console.log('Overall pass:', validationResult.overall);
    console.log('\nTest completed successfully!');
  })
  .catch(error => {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  });
