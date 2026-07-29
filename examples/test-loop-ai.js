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

console.log('Testing AI optimization for inefficient loop pattern...\n');

// Test code with inefficient loop pattern
const inefficientLoopCode = `
const items = [1, 2, 3, 4, 5];
const results = [];
for (let i = 0; i < items.length; i++) {
  results.push(items[i] * 2);
}
res.json({ results });
`;

console.log('Original inefficient loop pattern code:');
console.log(inefficientLoopCode);
console.log('\nRequesting AI optimization...');

llm.optimize(inefficientLoopCode, 'inefficient-loop')
  .then(optimizedCode => {
    console.log('AI Generated optimized code:');
    console.log(optimizedCode);
    console.log('\n✅ AI successfully generated optimization for inefficient loop pattern');
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  });
