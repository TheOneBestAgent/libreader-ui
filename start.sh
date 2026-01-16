#!/bin/bash

# LibRead Ereader - Quick Start Script
# This script starts the proxy server and opens the application

echo "🚀 Starting LibRead Ereader..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if port 3000 is in use
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Port 3000 is already in use. Killing existing process..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start the proxy server
echo "🌐 Starting proxy server on port 3000..."
node server.js &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Check if server started successfully
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ Proxy server started successfully (PID: $SERVER_PID)"
    echo ""
    echo "📚 Your LibRead Ereader is ready!"
    echo ""
    echo "Open your browser to:"
    echo "  → http://localhost:3000"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""
    
    # Try to open browser automatically
    if command -v xdg-open > /dev/null; then
        xdg-open http://localhost:3000
    elif command -v open > /dev/null; then
        open http://localhost:3000
    fi
    
    # Keep script running
    wait $SERVER_PID
else
    echo "❌ Failed to start server. Check server.log for errors."
    exit 1
fi
