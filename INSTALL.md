# VPS Installation Guide

Quick setup guide for deploying Soonyo on your VPS.

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
git clone https://github.com/splinesreticulating/soonyo-ai.git
cd soonyo-ai
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
MODEL=qwen/qwen-2.5-7b-instruct:free
```

Save and exit (Ctrl+X, Y, Enter in nano).

### 4. Test the gateway

```bash
npm start
```

You should see:
```
Soonyo gateway listening on port 3042
Model: qwen/qwen-2.5-7b-instruct:free
API key configured: yes
```

Keep this terminal open or Ctrl+C to stop.

### 5. Install the Eggdrop script

Open a new SSH session (or stop the gateway with Ctrl+C):

```bash
cp ~/soonyo-ai/eggdrop/soonyo.tcl ~/eggdrop/scripts/
```

Edit your eggdrop config:
```bash
nano ~/eggdrop/eggdrop.conf
```

Add this line at the end:
```tcl
source scripts/soonyo.tcl
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
cd ~/soonyo-ai/gateway
pm2 start npm --name soonyo-gateway -- start

# Save PM2 process list
pm2 save

# Set up auto-start on reboot
pm2 startup
# Follow the command it prints
```

### 8. Verify everything works

In IRC:
```
<you> @soonyo hello
<bot> Hi! How can I help?
```

Check gateway logs:
```bash
pm2 logs soonyo-gateway
```

---

## Quick Commands Reference

### Gateway management (PM2)

```bash
pm2 status                    # Check status
pm2 logs soonyo-gateway       # View logs
pm2 restart soonyo-gateway    # Restart
pm2 stop soonyo-gateway       # Stop
pm2 delete soonyo-gateway     # Remove from PM2
```

### Gateway management (manual)

```bash
cd ~/soonyo-ai/gateway
npm start                     # Start in foreground
```

### Update the bot

```bash
cd ~/soonyo-ai
git pull
cd gateway
npm install  # If package.json changed
pm2 restart soonyo-gateway
```

### Reinstall Tcl script after updates

```bash
cp ~/soonyo-ai/eggdrop/soonyo.tcl ~/eggdrop/scripts/
# Then .rehash in IRC
```

### Test gateway manually

```bash
curl http://127.0.0.1:3042/health
# Should return: OK

curl -X POST http://127.0.0.1:3042/soonyo \
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
pm2 logs soonyo-gateway
```

### Bot doesn't respond

```bash
# Check gateway is running
curl http://127.0.0.1:3042/health

# Check if script loaded
# In IRC DCC/partyline:
.tcl info loaded
# Should show soonyo.tcl

# Check bot console
.console +d
```

### "Gateway not configured" error

Your `.env` file is missing or `OPENROUTER_API_KEY` is not set.

```bash
cd ~/soonyo-ai/gateway
cat .env
# Should show your API key
```

### Permission issues

```bash
# Make sure eggdrop user owns everything
sudo chown -R eggdrop:eggdrop ~/soonyo-ai
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
- GitHub issues: https://github.com/splinesreticulating/soonyo-ai/issues
