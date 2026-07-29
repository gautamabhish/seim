#!/bin/bash

echo "Starting SEIM test API server..."
node test-api.js &
SERVER_PID=$!

echo "Waiting for server to start..."
sleep 3

echo "=========================================="
echo "Testing SEIM with sampleSize=5 for both learning and shadow testing"
echo "=========================================="

echo ""
echo "Making 10 requests to /api/sequential (sequential-async pattern)"
echo "Expected: Analysis should start after 5 requests (learning.sampleSize)"
echo "Expected: Shadow evaluation should happen after 5 samples (experiment.shadowSampleSize)"
echo ""

for i in {1..10}; do
  echo "Request $i:"
  curl -s http://localhost:3000/api/sequential
  echo ""
  sleep 0.5
done

echo ""
echo "Checking SEIM status..."
curl -s http://localhost:3000/seim/status | python3 -m json.tool
echo ""

echo ""
echo "Making 10 requests to /api/n-plus-one (n-plus-one pattern)"
echo ""

for i in {1..10}; do
  echo "Request $i:"
  curl -s http://localhost:3000/api/n-plus-one
  echo ""
  sleep 0.5
done

echo ""
echo "Checking SEIM status after additional requests..."
curl -s http://localhost:3000/seim/status | python3 -m json.tool
echo ""

echo ""
echo "Making 10 requests to /api/normal (no pattern)"
echo "Expected: No optimization candidates should be generated"
echo ""

for i in {1..10}; do
  echo "Request $i:"
  curl -s http://localhost:3000/api/normal
  echo ""
  sleep 0.5
done

echo ""
echo "Final SEIM status..."
curl -s http://localhost:3000/seim/status | python3 -m json.tool
echo ""

echo ""
echo "Stopping server..."
kill $SERVER_PID

echo "Test completed!"
