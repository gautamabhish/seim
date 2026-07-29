// Test the inefficient loop regex pattern
const inefficientLoopRegex = /for\s*\(let\s+\w+\s*=\s*0;\s*\w+\s*<\s*\w+\.length;\s*\w+\+\+\s*\)/;

const testCode = `
const items = [1, 2, 3, 4, 5];
const results = [];
for (let i = 0; i < items.length; i++) {
  results.push(items[i] * 2);
}
res.json({ results });
`;

console.log('Testing inefficient loop regex pattern:');
console.log('Pattern:', inefficientLoopRegex);
console.log('Test code:', testCode);
console.log('Match result:', inefficientLoopRegex.test(testCode));

// Test with the old pattern
const oldPattern = /for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*\w+\.length;\s*i\+\+\s*\)/;
console.log('Old pattern:', oldPattern);
console.log('Old pattern match:', oldPattern.test(testCode));

// Test the sequential async pattern
const sequentialPattern = /const\s+\w+\s*=\s*await\s+[^;]+;\s*\n\s*const\s+\w+\s*=\s*await\s+[^;]+;/;
const sequentialCode = `
const result1 = await fetchData(1);
const result2 = await fetchData(2);
res.json({ result1, result2 });
`;
console.log('Sequential pattern:', sequentialPattern);
console.log('Sequential code:', sequentialCode);
console.log('Sequential match:', sequentialPattern.test(sequentialCode));
