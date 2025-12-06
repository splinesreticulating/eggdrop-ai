# VPS Installation Guide

Quick setup guide for deploying Eggdrop AI on your VPS.

## Prerequisites

- VPS with SSH access
- User: `eggdrop`
- Eggdrop installed in `~/eggdrop`
- Node.js 18+ installed
- OpenRouter API key

## Step-by-Step Installation

### 1. SSH into your VPS

```bash
ssh eggdrop@your-vps-ip
```

### 2. Clone the repository

```bash
cd ~
git clone https://github.com/yourusername/eggdrop-ai.git
cd eggdrop-ai
```

### 3. Set up the gateway

```bash
cd gateway
npm install
cp .env.example .env
nano .env  # or vim, or any editor
```

Add your OpenRouter API key:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
PORT=3042
MODEL=qwen/qwen3-4b:free
```

Save and exit (Ctrl+X, Y, Enter in nano).

### 4. Test the gateway

```bash
npm start
```

You should see:
```
Eggdrop AI gateway listening on port 3042
Model: qwen/qwen3-4b:free
API key configured: yes
```

Keep this terminal open or Ctrl+C to stop.

### 5. Install the Eggdrop script

Open a new SSH session (or stop the gateway with Ctrl+C):

```bash
cp ~/eggdrop-ai/eggdrop/eggdrop-ai.tcl ~/eggdrop/scripts/
```

Edit your eggdrop config:
```bash
nano ~/eggdrop/eggdrop.conf
```

Add this line at the end:
```tcl
source scripts/eggdrop-ai.tcl
```

Save and exit.

### 6. Rehash Eggdrop

Connect to your bot via DCC or partyline and run:
```
.rehash
```

Or restart the bot:
```bash
cd ~/eggdrop
./eggdrop -m eggdrop.conf
```

### 7. Set up gateway as a service (production)

Use PM2 for easy process management:

```bash
# Install PM2 globally
npm install -g pm2

# Start the gateway
cd ~/eggdrop-ai/gateway
pm2 start npm --name eggdrop-ai-gateway -- start

# Save PM2 process list
pm2 save

# Set up auto-start on reboot
pm2 startup
# Follow the command it prints
```

### 8. Verify everything works

In IRC (replace `@botname` with your bot's actual nickname):
```
<you> @botname hello
<bot> Hi! How can I help?
```

Check gateway logs:
```bash
pm2 logs eggdrop-ai-gateway
```

---

## Quick Commands Reference

### Gateway management (PM2)

```bash
pm2 status                        # Check status
pm2 logs eggdrop-ai-gateway       # View logs
pm2 restart eggdrop-ai-gateway    # Restart
pm2 stop eggdrop-ai-gateway       # Stop
pm2 delete eggdrop-ai-gateway     # Remove from PM2
```

### Gateway management (manual)

```bash
cd ~/eggdrop-ai/gateway
npm start                     # Start in foreground
```

### Update the bot

```bash
cd ~/eggdrop-ai
git pull
cd gateway
npm install  # If package.json changed
pm2 restart eggdrop-ai-gateway
```

### Reinstall Tcl script after updates

```bash
cp ~/eggdrop-ai/eggdrop/eggdrop-ai.tcl ~/eggdrop/scripts/
# Then .rehash in IRC
```

### Test gateway manually

```bash
curl http://127.0.0.1:3042/health
# Should return: OK

curl -X POST http://127.0.0.1:3042/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","user":"testuser","channel":"#test"}'
```

---

## Troubleshooting

### Gateway won't start

```bash
# Check if port 3042 is already in use
netstat -tulpn | grep 3042

# Check Node.js version (need 18+)
node --version

# Check logs
pm2 logs eggdrop-ai-gateway
```

### Bot doesn't respond

```bash
# Check gateway is running
curl http://127.0.0.1:3042/health

# Check if script loaded
# In IRC DCC/partyline:
.tcl info loaded
# Should show eggdrop-ai.tcl

# Check bot console
.console +d
```

### "Gateway not configured" error

Your `.env` file is missing or `OPENROUTER_API_KEY` is not set.

```bash
cd ~/eggdrop-ai/gateway
cat .env
# Should show your API key
```

### Permission issues

```bash
# Make sure eggdrop user owns everything
sudo chown -R eggdrop:eggdrop ~/eggdrop-ai
sudo chown -R eggdrop:eggdrop ~/eggdrop
```

---

## Security Notes

- Gateway listens on `127.0.0.1` (localhost only) - not exposed to internet
- Keep your OpenRouter API key secret
- Monitor usage at https://openrouter.ai/activity
- The Tcl script has built-in rate limiting (10s per user)

---

## Need Help?

- Check the main README.md for detailed docs
- OpenRouter docs: https://openrouter.ai/docs
- Eggdrop docs: https://docs.eggheads.org/
- GitHub issues: https://github.com/yourusername/eggdrop-ai/issues
