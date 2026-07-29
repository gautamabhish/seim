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

console.log('Testing AI optimization for N+1 query pattern (v2)...\n');

// Test code with N+1 query pattern - simpler version
const nPlusOneCode = `
const users = await fetchUsers();
const results = [];
for (const user of users) {
  const userDetails = await fetchUserDetails(user.id);
  results.push(userDetails);
}
res.json({ results });
`;

console.log('Original N+1 pattern code:');
console.log(nPlusOneCode);
console.log('\nRequesting AI optimization...');

llm.optimize(nPlusOneCode, 'n-plus-one')
  .then(optimizedCode => {
    console.log('AI Generated optimized code:');
    console.log(optimizedCode);
    console.log('\n✅ AI successfully generated optimization for N+1 pattern');
    
    if (!optimizedCode || optimizedCode.trim().length === 0) {
      console.log('⚠️  AI returned empty optimization, trying with different pattern...');
      
      // Try with missing-cache pattern instead
      return llm.optimize(nPlusOneCode, 'missing-cache');
    }
  })
  .then(optimizedCode => {
    if (optimizedCode) {
      console.log('Alternative optimization:');
      console.log(optimizedCode);
    }
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  });
