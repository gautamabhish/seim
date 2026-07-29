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

console.log('Testing AI optimization for blocking operation pattern...\n');

// Test code with blocking operation pattern
const blockingOpCode = `
const fs = require('fs');
const data = fs.readFileSync('/tmp/test.txt', 'utf8');
res.json({ data });
`;

console.log('Original blocking operation pattern code:');
console.log(blockingOpCode);
console.log('\nRequesting AI optimization...');

llm.optimize(blockingOpCode, 'blocking-op')
  .then(optimizedCode => {
    console.log('AI Generated optimized code:');
    console.log(optimizedCode);
    console.log('\n✅ AI successfully generated optimization for blocking operation pattern');
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  });
