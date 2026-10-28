MBS website on a free Oracle Cloud server (Always Free)
=====================================================

What you end up with: the same website and Mr. Fixit that run on your PC, running 24/7 on a
server in Sydney, at https://mbsplc.com.au, restarting by itself, with a
backup of every enquiry each night.

You need: your GitHub repository (with branch MBS-FixIT-ver-21), your working .env on your PC,
a credit or debit card for Oracle's identity check (Always Free resources are not charged),
and access to the domain's DNS settings (where mbsplc.com.au is registered).

Never upload .env or the server key (mbs.key) to GitHub, email or chat.


PART A - CREATE THE FREE SERVER (Oracle website, about 20 minutes)
-------------------------------------------------------------------
1. Go to https://www.oracle.com/cloud/free/ and click "Start for free".
   HOME REGION: choose "Australia East (Sydney)" (or Australia Southeast (Melbourne)).
   This cannot be changed later.

2. When the account is ready, sign in. Menu (top left) > Compute > Instances > Create instance.
     Name ............ mbs-website
     Image ........... click Change image > Ubuntu > Canonical Ubuntu 24.04
     Shape ........... click Change shape > Ampere > VM.Standard.A1.Flex
                       1 OCPU and 6 GB memory is plenty (look for the "Always Free-eligible" label)
     Networking ...... keep the defaults; "Assign a public IPv4 address" must be YES
     Add SSH keys .... "Generate a key pair for me" > click "Save private key".
                       Save it as  C:\Workzone\2026\oracle\mbs.key
   Click Create. After a minute or two the state shows RUNNING.
   If you see "Out of capacity": try again later, pick another Availability Domain, or use the
   shape VM.Standard.E2.1.Micro (also Always Free, smaller, still enough for this site).

3. Copy the server's "Public IP address" from the instance page (for example 152.67.xx.xx).

4. Open the web ports in Oracle's network:
   On the instance page click the Subnet link > Security Lists > Default Security List >
   Add Ingress Rules:
     Source CIDR 0.0.0.0/0   IP Protocol TCP   Destination Port Range 80    > Add
   and again with Destination Port Range 443.
   (Port 22 for SSH is already open.)


PART B - CONNECT FROM YOUR PC (PowerShell)
------------------------------------------
5. Protect the key file (Windows refuses to use a key that others can read). In PowerShell:
     icacls "C:\Workzone\2026\oracle\mbs.key" /inheritance:r
     icacls "C:\Workzone\2026\oracle\mbs.key" /grant:r "$($env:USERNAME):(R)"

6. Copy the setup script AND your keys to the server (replace the IP with yours).
   Use the .env that works on your PC (the folder you start the site from):
     scp -i "C:\Workzone\2026\oracle\mbs.key" "C:\Workzone\2026\MBSFIXITVER21\deploy\setup-server.sh" ubuntu@152.67.xx.xx:~
     scp -i "C:\Workzone\2026\oracle\mbs.key" "C:\PATH\TO\YOUR\WORKING\SITE\.env" ubuntu@152.67.xx.xx:~/mbs.env
   First time it asks "Are you sure you want to continue connecting?" - type yes.
   scp sends the file encrypted, straight to the server. The keys never go to GitHub.
   The setup moves mbs.env into the site folder, readable only by the server's user.

7. Log in to the server:
     ssh -i "C:\Workzone\2026\oracle\mbs.key" ubuntu@152.67.xx.xx
   The prompt changes to something like  ubuntu@mbs-website:~$  - you are now on the server.


PART C - INSTALL THE SITE (on the server, about 10 minutes)
-----------------------------------------------------------
8. Run the setup with your GitHub repository address:
     bash setup-server.sh https://github.com/YOUR-USERNAME/mbs-website.git

   It installs everything, then:
   - shows a long line starting "ssh-ed25519 ..." (a "deploy key"). In GitHub open your
     repository > Settings > Deploy keys > Add deploy key. Title: MBS server. Paste the line.
     Leave "Allow write access" OFF. Click Add key. Back in the server window press Enter.
   - picks up your keys from mbs.env (step 6) by itself. Only if you skipped step 6 does it
     open an editor instead: then copy each key from your PC's .env (Notepad) into the same
     line (LLM_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESEND_API_KEY, OWNER_EMAIL,
     AZURE_SPEECH_KEY ...). Right-click pastes in the PowerShell window.
     Save with Ctrl+O then Enter, close with Ctrl+X.

9. When it says Done, open  http://YOUR-SERVER-IP  on your phone or PC. The site and Mr. Fixit
   should work. Send a test enquiry: it should arrive by email and Telegram.


PART D - YOUR DOMAIN AND HTTPS
------------------------------
10. Where the domain is managed (the registrar / DNS provider), set two "A" records:
      Host @    (mbsplc.com.au)       -> YOUR-SERVER-IP
      Host www  (mbsplc.com.au)   -> YOUR-SERVER-IP
    Remove any old A/AAAA/CNAME records for @ and www that point elsewhere.
    Changes usually work within an hour (can take up to a day).

11. Then on the server run the setup again, this time with the domain:
      bash ~/mbs-website/deploy/setup-server.sh https://github.com/YOUR-USERNAME/mbs-website.git mbsplc.com.au
    Caddy gets a free HTTPS certificate by itself. Open https://mbsplc.com.au
    (the plain address without www forwards there too).

12. Email from the real domain: in Resend (resend.com > Domains) add mbsplc.com.au
    and add the DNS records it shows at your DNS provider. When it says Verified, on the server:
      nano ~/mbs-website/.env
    change  FROM_EMAIL=MBS Website <website@mbsplc.com.au>
    and OWNER_EMAIL to the business email, save, then:  bash ~/mbs-website/deploy/update.sh


EVERYDAY USE
------------
Publish a new version:
  On your PC (in C:\Workzone\2026\MBSFIXITVER21):
      git add -A
      git commit -m "what changed"
      git push
  Then on the server:
      bash ~/mbs-website/deploy/update.sh

Is it running?            bash ~/mbs-website/deploy/status.sh
Restart it:               sudo systemctl restart mbs-website
Change keys:              nano ~/mbs-website/.env   then   sudo systemctl restart mbs-website
Enquiries:                cd ~/mbs-website && node tools/jobs.mjs list
Backups:                  every night at 2am into ~/mbs-backups (30 days kept). Copy them to your PC now and then:
                          scp -i "C:\Workzone\2026\oracle\mbs.key" "ubuntu@YOUR-SERVER-IP:~/mbs-backups/*.tar.gz" C:\Workzone\2026\backups\

Limits per visitor (stop abuse): in .env  LIMIT_CHAT=40/10  LIMIT_TTS=80/10  LIMIT_LEAD=8/60
(requests / minutes). A visitor who goes over is asked to call 0420 494 990.

Your keys (.env)
- They live in two places only: your PC and the server (~/mbs-website/.env). Never in GitHub.
- Change a key on the server:  nano ~/mbs-website/.env   then   sudo systemctl restart mbs-website
  Or send your PC's .env again:  scp -i ... .env ubuntu@IP:~/mbs-website/.env   then on the server
  run  bash ~/mbs-website/deploy/setup-server.sh <repo> <domain>  (it fixes Windows line endings
  and keeps the server settings) or restart as above.
- The nightly backups include .env, so keep backup copies private too.
- If a key is ever exposed: create a new one at the provider (DeepSeek, Telegram @BotFather
  /revoke, Resend, Azure), delete the old one there, then update .env and restart.

Notes
- Oracle can reclaim Always Free servers it considers idle (very low use for a week). A live
  website normally keeps it busy enough, but keep your backups on your PC.
- If the server is ever lost: create a new one (Part A to C), then copy the latest backup back:
      scp -i ... mbs-YYYY-MM-DD_HHMM.tar.gz ubuntu@NEW-IP:~
      ssh ... then:  cd ~/mbs-website && tar -xzf ~/mbs-YYYY-MM-DD_HHMM.tar.gz && sudo systemctl restart mbs-website
