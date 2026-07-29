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

console.log('Testing AI optimization for redundant serialization pattern...\n');

// Test code with redundant serialization pattern
const redundantSerializationCode = `
const data = { key: 'value' };
const copied = JSON.parse(JSON.stringify(data));
res.json({ copied });
`;

console.log('Original redundant serialization pattern code:');
console.log(redundantSerializationCode);
console.log('\nRequesting AI optimization...');

llm.optimize(redundantSerializationCode, 'redundant-serialization')
  .then(optimizedCode => {
    console.log('AI Generated optimized code:');
    console.log(optimizedCode);
    console.log('\n✅ AI successfully generated optimization for redundant serialization pattern');
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  });
