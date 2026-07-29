const { LLMClient } = require('./dist/ai.js');
const { mergeConfig } = require('./dist/config.js');

// Test AI client with Gemini configuration
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

console.log('Testing AI client with Gemini...');
console.log('Provider:', config.ai.provider);
console.log('Model:', config.ai.generatorModel);
console.log('Base URL:', config.ai.baseUrl);
console.log('');

// Test with a simple optimization request
const testCode = `
const result1 = await fetchData(1);
const result2 = await fetchData(2);
res.json({ result1, result2 });
`;

console.log('Testing optimization for sequential-async pattern...');
console.log('Input code:', testCode.trim());
console.log('');

llm.optimize(testCode, 'sequential-async')
  .then(result => {
    console.log('Optimization result:', result);
    console.log('Success: AI optimization worked!');
  })
  .catch(error => {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  });
