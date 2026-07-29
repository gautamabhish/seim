const { LLMClient } = require('./dist/ai.js');
const { mergeConfig } = require('./dist/config.js');

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

console.log('Testing AI optimization for nested ternary pattern...\n');

// Test code with nested ternary pattern
const nestedTernaryCode = `
const score = 85;
const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
res.json({ score, grade });
`;

console.log('Original nested ternary pattern code:');
console.log(nestedTernaryCode);
console.log('\nRequesting AI optimization...');

llm.optimize(nestedTernaryCode, 'nested-ternary')
  .then(optimizedCode => {
    console.log('AI Generated optimized code:');
    console.log(optimizedCode);
    console.log('\n✅ AI successfully generated optimization for nested ternary pattern');
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  });
