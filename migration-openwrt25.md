# Plan: Clean Migration to OpenWRT 25

## Context

Router **Ayodhya** (**Bananapi BPi-R3**, MediaTek MT7986/filogic) currently runs **OpenWrt 24.10.4**. The goal is a clean flash to **OpenWRT 25** with full restoration of the complex configuration, including 3 WireGuard tunnels, policy-based routing, domain-based VPN routing via dnsmasq/nftset, custom scripts, and cron jobs.

**Execution method**: Through MCP tools (Claude executes commands on the router via SSH), step by step with user confirmation.

**Cleanup**: Duplicate routes (Telegram) and orphan forwarding rules will NOT be restored. Clean config only.

> **IMPORTANT**: This is a clean install — all data on the router will be wiped. Every custom file and config must be backed up beforehand.

---

## Phase 1: Pre-Migration Backup (DO BEFORE FLASHING)

### 1.1 Backup all UCI config files

Save these from `/etc/config/` to local machine:

| File | Contents |
|------|----------|
| `network` | LAN/WAN, WireGuard interfaces (wg0/wg1/wg2) + private keys, routes, ip rules |
| `firewall` | Zones (lan/wan/wg/wg2/lanToWg/wg1Towg2), rules, ipset vpn_domains, forwarding |
| `dhcp` | dnsmasq settings, DHCP ranges, 11 static leases |
| `wireless` | 3 SSIDs (Ayodhya, Ayodhya5G, Ayodhya-IoT), passwords, radio settings |
| `system` | Hostname "Ayodhya", timezone Europe/Belgrade |
| `dropbear` | SSH: LAN port 22 (password), WAN port 10822 (key-only) |
| `pbr` | PBR config: policies, includes, supported interfaces |

**Command to run on router:**
```sh
mkdir -p /tmp/backup
cp /etc/config/network /etc/config/firewall /etc/config/dhcp \
   /etc/config/wireless /etc/config/system /etc/config/dropbear \
   /etc/config/pbr /tmp/backup/
```

### 1.2 Backup custom files

| File | Purpose |
|------|---------|
| `/etc/dnsmasq.d/myipset.conf` | 150+ custom domain nftset rules |
| `/etc/dnsmasq.d/blocked.conf` | TikTok domain blocking |
| `/etc/dnsmasq.d/99-msftncsi.conf` | MS NCSI rebind fix |
| `/usr/share/pbr/pbr.user.dns` | ISP DNS hijack bypass (routes 8.8.8.8/1.1.1.1 through wg2) |
| `/etc/iproute2/rt_tables` | Custom routing tables: vpn(100), pbr_wan(256), pbr_wg0(257), pbr_wg1(258), pbr_wg2(259) |
| `/etc/dropbear/authorized_keys` | SSH public key for remote access |

```sh
cp /etc/dnsmasq.d/myipset.conf /etc/dnsmasq.d/blocked.conf \
   /etc/dnsmasq.d/99-msftncsi.conf /tmp/backup/
cp /usr/share/pbr/pbr.user.dns /tmp/backup/
cp /etc/iproute2/rt_tables /tmp/backup/
cp /etc/dropbear/authorized_keys /tmp/backup/
```

### 1.3 Backup custom scripts

| File | Purpose |
|------|---------|
| `/root/update-vpn-domains.sh` | Weekly v2fly domain list updater for dnsmasq |
| `/root/tc-throttle.sh` | Traffic throttling for specific IPs |
| `/root/dns/update_telegram_routes.py` | Telegram IP CIDR route updater via UCI |
| `/root/dns/update_ipset.py` | Generate nftset config from domains.list |
| `/root/dns/domains.list` | Master domain list for VPN routing (~150 domains) |

```sh
cp /root/update-vpn-domains.sh /root/tc-throttle.sh /tmp/backup/
cp -r /root/dns /tmp/backup/
```

### 1.4 Record cron jobs

```
0 4 * * 0 /root/update-vpn-domains.sh
0 4 * * 0 python3 /root/dns/update_telegram_routes.py >> /var/log/telegram-routes-update.log 2>&1
```

### 1.5 Save WireGuard keys (CRITICAL)

These are embedded in `/etc/config/network` but record separately for safety:

| Interface | Private Key |
|-----------|-------------|
| wg0 | `kPKhh8g/4zSQZ4jQt+4ZQGwlxan2q5ZVXWkqrGLE8lo=` |
| wg1 | `MHH7AImLAmWK7X4HFsQqhB3OFRUsudBHNih4xSSam3o=` |
| wg2 | `YNW7ZfwyjelugE23DoA1ZbX9E/V/slDhwZqW5zee0EU=` |

Peers public keys, PSKs, and endpoints are also in the network config backup.

### 1.6 Download backup archive to local machine

```sh
cd /tmp/backup && tar czf /tmp/ayodhya-backup.tar.gz .
```
Then SCP from local machine:
```sh
scp -P 10822 -i ~/.ssh/aoydhya root@185.82.26.70:/tmp/ayodhya-backup.tar.gz ./
```

### 1.7 Record WiFi passwords

- SSID `Ayodhya` (2.4G, sae-mixed): `Rama565108`
- SSID `Ayodhya5G` (5G, sae-mixed): `Rama565108`
- SSID `Ayodhya-IoT` (2.4G, psk2): `Rama565108`

---

## Phase 2: Flash OpenWRT 25

### 2.1 Download firmware

Download OpenWRT 25 sysupgrade image for **Bananapi BPi-R3** (mediatek/filogic, MT7986) from the official site:
- Target: `mediatek/filogic`
- Profile: `bananapi_bpi-r3`
- Image type: `sysupgrade` (for flashing from existing OpenWRT)

### 2.2 Flash

Via LuCI (System > Backup/Flash) or CLI:
```sh
sysupgrade -n /tmp/openwrt-25-*.bin
```

> `-n` = do NOT preserve config (clean install)

### 2.3 Wait for reboot

Router will reboot with default config (192.168.1.1, no password). Connect via LAN.

---

## Phase 3: Base System Setup

### 3.1 Initial access & password

```sh
ssh root@192.168.1.1
passwd
```

### 3.2 Install required packages

```sh
opkg update

# Core networking
opkg install wireguard-tools kmod-wireguard luci-proto-wireguard
opkg install pbr luci-app-pbr
opkg install tc-full

# LuCI
opkg install luci luci-ssl luci-app-firewall luci-app-package-manager

# Python (for telegram routes script)
opkg install python3 python3-urllib python3-light

# Optional dev tools (install only if needed)
# opkg install git node node-npm gcc make iperf3
```

### 3.3 Upload backup to router

```sh
scp -i ~/.ssh/aoydhya ayodhya-backup.tar.gz root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "cd /tmp && tar xzf ayodhya-backup.tar.gz"
```

---

## Phase 4: Restore Configuration (step by step, in order)

> **IMPORTANT**: Restore in this exact order. Network must come before firewall, firewall before PBR. Test connectivity at each step.

### Step 4.1: System settings

```sh
uci set system.@system[0].hostname='Ayodhya'
uci set system.@system[0].timezone='CET-1CEST,M3.5.0,M10.5.0/3'
uci set system.@system[0].zonename='Europe/Belgrade'
uci set system.@system[0].log_size='128'
uci set system.@system[0].conloglevel='8'
uci set system.@system[0].cronloglevel='7'
uci commit system
/etc/init.d/system reload
```

### Step 4.2: SSH (Dropbear)

```sh
# Keep LAN access open for now, configure WAN SSH
uci add dropbear dropbear
uci set dropbear.@dropbear[-1].Interface='wan'
uci set dropbear.@dropbear[-1].Port='10822'
uci set dropbear.@dropbear[-1].PasswordAuth='off'
uci set dropbear.@dropbear[-1].RootPasswordAuth='off'
uci commit dropbear

# Restore authorized keys
cp /tmp/backup/authorized_keys /etc/dropbear/authorized_keys
chmod 600 /etc/dropbear/authorized_keys

/etc/init.d/dropbear restart
```

### Step 4.3: Network — LAN & WAN

```sh
# LAN
uci set network.lan.ipaddr='192.168.108.1'
uci set network.lan.netmask='255.255.255.0'
uci delete network.lan.dns 2>/dev/null
uci add_list network.lan.dns='192.168.108.1'
uci set network.lan.delegate='0'

# WAN bridge (check if device names changed in OpenWRT 25!)
# May need to verify: 'eth1', 'wan' port names for br-wan
uci set network.wan.proto='dhcp'

# Disable IPv6 WAN
uci set network.wan6.disabled='1'

uci commit network
/etc/init.d/network restart
```

> **CHECKPOINT**: Verify LAN is 192.168.108.1, WAN gets DHCP from ISP. If bridge device names changed in OpenWRT 25, adjust accordingly.

### Step 4.4: WiFi

```sh
# 2.4 GHz
uci set wireless.radio0.country='RU'
uci set wireless.radio0.channel='auto'
uci set wireless.radio0.htmode='HE40'
uci set wireless.radio0.txpower='18'

uci set wireless.default_radio0.ssid='Ayodhya'
uci set wireless.default_radio0.encryption='sae-mixed'
uci set wireless.default_radio0.key='Rama565108'
uci set wireless.default_radio0.ocv='0'

# 5 GHz
uci set wireless.radio1.channel='auto'
uci set wireless.radio1.htmode='HE160'

uci set wireless.default_radio1.ssid='Ayodhya5G'
uci set wireless.default_radio1.encryption='sae-mixed'
uci set wireless.default_radio1.key='Rama565108'
uci set wireless.default_radio1.ocv='0'

# IoT (additional 2.4G AP)
uci add wireless wifi-iface
uci set wireless.@wifi-iface[-1].device='radio0'
uci set wireless.@wifi-iface[-1].mode='ap'
uci set wireless.@wifi-iface[-1].network='lan'
uci set wireless.@wifi-iface[-1].ssid='Ayodhya-IoT'
uci set wireless.@wifi-iface[-1].encryption='psk2'
uci set wireless.@wifi-iface[-1].key='Rama565108'

uci commit wireless
wifi reload
```

### Step 4.5: DHCP & DNS (dnsmasq)

```sh
# DHCP settings
uci set dhcp.@dnsmasq[0].cachesize='1000'
uci set dhcp.@dnsmasq[0].confdir='/etc/dnsmasq.d'
uci set dhcp.@dnsmasq[0].serversfile='/etc/dnsmasq.servers'
uci add_list dhcp.@dnsmasq[0].addnmount='/var/run/pbr.dnsmasq'

# Static leases (add all)
for entry in \
  "Xiaomi14Ultra E8:98:47:86:55:BD 192.168.108.50" \
  "Rishikesh E8:FB:1C:1B:6D:BA 192.168.108.51" \
  "VM1 00:0C:29:64:74:24 192.168.108.52" \
  "Aida-iPhone 5A:64:41:01:10:52 192.168.108.53" \
  "VM2 52:54:00:EF:83:1C 192.168.108.54" \
  "RSFC5CEE5CB099 4C:5F:70:41:CB:9D 192.168.108.55" \
  "VM3 52:54:00:8F:F1:F9 192.168.108.56" \
  "Feodor-iPhone 06:A9:44:F3:43:5E 192.168.108.61" \
  "device62 F6:65:E6:11:90:72 192.168.108.62" \
  "ibs-ubuntu ae:fc:9f:38:08:88 192.168.108.161" \
  "device63 02:68:4D:5D:28:A9 192.168.108.63"; do
  set -- $entry
  uci add dhcp host
  uci set dhcp.@host[-1].name="$1"
  uci add_list dhcp.@host[-1].mac="$2"
  uci set dhcp.@host[-1].ip="$3"
done

# Devices with multiple MACs (add additional MACs)
# Aida-iPhone: second MAC
uci add_list dhcp.@host[3].mac='AA:2A:BE:0A:9C:B7'
# Feodor-iPhone: second MAC
uci add_list dhcp.@host[7].mac='60:7E:C9:B3:3B:D0'

uci commit dhcp
```

### Step 4.6: WireGuard interfaces

```sh
# wg0 — Primary VPN Server
uci set network.wg0=interface
uci set network.wg0.proto='wireguard'
uci set network.wg0.private_key='kPKhh8g/4zSQZ4jQt+4ZQGwlxan2q5ZVXWkqrGLE8lo='
uci set network.wg0.listen_port='10810'
uci add_list network.wg0.addresses='10.0.0.1/24'
uci set network.wg0.defaultroute='0'

# wg0 peer: serbia
uci add network wireguard_wg0
uci set network.@wireguard_wg0[-1].description='serbia'
uci set network.@wireguard_wg0[-1].public_key='bp5UtrEQsxqj8s6eA4eJRVM0LtQq8JpQYBEIp1bvowg='
uci set network.@wireguard_wg0[-1].preshared_key='R+CtP/rQ7k5czGjfPiYY82UNeGFphnGTu3t5hwt9bQE='
uci add_list network.@wireguard_wg0[-1].allowed_ips='10.0.0.2/32'
uci add_list network.@wireguard_wg0[-1].allowed_ips='0.0.0.0/0'

# wg1 — Secondary VPN Server
uci set network.wg1=interface
uci set network.wg1.proto='wireguard'
uci set network.wg1.private_key='MHH7AImLAmWK7X4HFsQqhB3OFRUsudBHNih4xSSam3o='
uci set network.wg1.listen_port='10109'
uci add_list network.wg1.addresses='10.0.1.1/24'
uci set network.wg1.defaultroute='0'

# wg1 peer: my-peer1
uci add network wireguard_wg1
uci set network.@wireguard_wg1[-1].description='my-peer1'
uci set network.@wireguard_wg1[-1].public_key='62eGiY0/42Ty42mpmutbK3J8H+m1hk9Jaxm3LGuddEI='
uci set network.@wireguard_wg1[-1].persistent_keepalive='25'
uci add_list network.@wireguard_wg1[-1].allowed_ips='10.0.1.11/32'

# wg1 peer: max (disabled)
uci add network wireguard_wg1
uci set network.@wireguard_wg1[-1].description='max'
uci set network.@wireguard_wg1[-1].public_key='e9c3YfCQh0gYFTTzfk0A3PoLqccniMTSLjWCNbpWIE4='
uci set network.@wireguard_wg1[-1].persistent_keepalive='24'
uci add_list network.@wireguard_wg1[-1].allowed_ips='10.0.1.12/32'
uci set network.@wireguard_wg1[-1].disabled='1'

# wg2 — VPN Client (outbound to Serbia)
uci set network.wg2=interface
uci set network.wg2.proto='wireguard'
uci set network.wg2.private_key='YNW7ZfwyjelugE23DoA1ZbX9E/V/slDhwZqW5zee0EU='
uci set network.wg2.listen_port='10802'
uci add_list network.wg2.addresses='10.0.2.1/24'
uci set network.wg2.nohostroute='1'
uci set network.wg2.defaultroute='0'

# wg2 peer: Serbia_In (active, full tunnel)
uci add network wireguard_wg2
uci set network.@wireguard_wg2[-1].description='Serbia_In'
uci set network.@wireguard_wg2[-1].public_key='TWQmj+rRz1DDriSSpnmxhP/fL57xGFKQ0ud3ACqTDgk='
uci set network.@wireguard_wg2[-1].persistent_keepalive='25'
uci add_list network.@wireguard_wg2[-1].allowed_ips='10.0.2.10/32'
uci add_list network.@wireguard_wg2[-1].allowed_ips='0.0.0.0/0'

# wg2 peer: test_connection
uci add network wireguard_wg2
uci set network.@wireguard_wg2[-1].description='test_connection'
uci set network.@wireguard_wg2[-1].public_key='9Tj4qajW6Iowf/YSemhhmksEe5x8JEiWQeW3WEWJ0Qs='
uci set network.@wireguard_wg2[-1].persistent_keepalive='25'
uci add_list network.@wireguard_wg2[-1].allowed_ips='10.0.2.11/32'

uci commit network
```

### Step 4.7: Routing rules & routes

```sh
# IP rule: fwmark 0x1 -> vpn table
uci add network rule
uci set network.@rule[-1].name='mark0x1'
uci set network.@rule[-1].mark='0x1'
uci set network.@rule[-1].priority='100'
uci set network.@rule[-1].lookup='vpn'

# IP rules: bypass VPN for specific IPs
uci add network rule
uci set network.@rule[-1].name='bypass_vpn_61'
uci set network.@rule[-1].src='192.168.108.61'
uci set network.@rule[-1].priority='95'
uci set network.@rule[-1].lookup='pbr_wan'

uci add network rule
uci set network.@rule[-1].name='bypass_vpn_62'
uci set network.@rule[-1].src='192.168.108.62'
uci set network.@rule[-1].priority='95'
uci set network.@rule[-1].lookup='pbr_wan'

# Static routes: DNS through wg0 (in main table, kept for reference)
uci add network route
uci set network.@route[-1].target='8.8.8.8/32'
uci set network.@route[-1].gateway='10.0.0.2'
uci set network.@route[-1].metric='0'
uci set network.@route[-1].interface='wg0'

uci add network route
uci set network.@route[-1].target='1.1.1.1/32'
uci set network.@route[-1].gateway='10.0.0.1'
uci set network.@route[-1].metric='0'
uci set network.@route[-1].interface='wg0'

# Google IP ranges through wg0
uci add network route
uci set network.@route[-1].target='172.217.0.0/16'
uci set network.@route[-1].gateway='10.0.0.2'
uci set network.@route[-1].interface='wg0'

uci add network route
uci set network.@route[-1].target='142.250.0.0/16'
uci set network.@route[-1].gateway='10.0.0.2'
uci set network.@route[-1].interface='wg0'

# VPN routing table: default via wg0
uci add network route
uci set network.@route[-1].interface='wg0'
uci set network.@route[-1].target='0.0.0.0/0'
uci set network.@route[-1].gateway='10.0.0.2'
uci set network.@route[-1].table='vpn'

# Routing table definitions
cat > /etc/iproute2/rt_tables << 'EOF'
#
# reserved values
#
128	prelocal
255	local
254	main
253	default
0	unspec
#
# local
#
#1	inr.ruhep
100	vpn
256 pbr_wan
257 pbr_wg0
258 pbr_wg1
259 pbr_wg2
EOF

uci commit network
/etc/init.d/network restart
```

> **CHECKPOINT**: Verify WireGuard interfaces are up: `wg show`. Verify WAN connectivity. Do NOT proceed if broken.

### Step 4.8: Firewall

```sh
# Zone: wg (wg0 + wg1)
uci add firewall zone
uci set firewall.@zone[-1].name='wg'
uci set firewall.@zone[-1].input='ACCEPT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='ACCEPT'
uci set firewall.@zone[-1].mtu_fix='1'
uci set firewall.@zone[-1].masq='1'
uci add_list firewall.@zone[-1].network='wg0'
uci add_list firewall.@zone[-1].network='wg1'

# Zone: wg2
uci add firewall zone
uci set firewall.@zone[-1].name='wg2'
uci set firewall.@zone[-1].input='ACCEPT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='ACCEPT'
uci set firewall.@zone[-1].masq='1'
uci set firewall.@zone[-1].mtu_fix='1'
uci add_list firewall.@zone[-1].network='wg2'

# Zone: lanToWg (special routing zone)
uci add firewall zone
uci set firewall.@zone[-1].name='lanToWg'
uci set firewall.@zone[-1].input='ACCEPT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='ACCEPT'
uci set firewall.@zone[-1].mtu_fix='1'
uci add_list firewall.@zone[-1].network='lan'

# Zone: wg1Towg2
uci add firewall zone
uci set firewall.@zone[-1].name='wg1Towg2'
uci set firewall.@zone[-1].input='ACCEPT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='ACCEPT'
uci set firewall.@zone[-1].masq='1'
uci add_list firewall.@zone[-1].network='wg1'

# Forwarding rules
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='wg'; uci set firewall.@forwarding[-1].dest='lan'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='wg'; uci set firewall.@forwarding[-1].dest='wan'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='wg2'; uci set firewall.@forwarding[-1].dest='lan'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='wg2'; uci set firewall.@forwarding[-1].dest='wan'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='lanToWg'; uci set firewall.@forwarding[-1].dest='wg'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='lanToWg'; uci set firewall.@forwarding[-1].dest='wg2'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='wg1Towg2'; uci set firewall.@forwarding[-1].dest='wg2'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='lan'; uci set firewall.@forwarding[-1].dest='wg'
uci add firewall forwarding; uci set firewall.@forwarding[-1].src='lan'; uci set firewall.@forwarding[-1].dest='wg2'

# Inbound rules for WAN
uci add firewall rule; uci set firewall.@rule[-1].name='SSH WAN Access'; uci set firewall.@rule[-1].src='wan'; uci add_list firewall.@rule[-1].proto='tcp'; uci set firewall.@rule[-1].dest_port='10822'; uci set firewall.@rule[-1].target='ACCEPT'; uci set firewall.@rule[-1].family='ipv4'
uci add firewall rule; uci set firewall.@rule[-1].name='Allow-WG0-In'; uci set firewall.@rule[-1].src='wan'; uci set firewall.@rule[-1].proto='udp'; uci set firewall.@rule[-1].dest_port='10810'; uci set firewall.@rule[-1].target='ACCEPT'; uci set firewall.@rule[-1].family='ipv4'
uci add firewall rule; uci set firewall.@rule[-1].name='Allow-WG1-In'; uci set firewall.@rule[-1].src='wan'; uci add_list firewall.@rule[-1].proto='udp'; uci set firewall.@rule[-1].dest_port='10109'; uci set firewall.@rule[-1].target='ACCEPT'; uci set firewall.@rule[-1].family='ipv4'
uci add firewall rule; uci set firewall.@rule[-1].name='Allow-WG2-In'; uci set firewall.@rule[-1].src='wan'; uci add_list firewall.@rule[-1].proto='udp'; uci set firewall.@rule[-1].dest_port='10802'; uci set firewall.@rule[-1].target='ACCEPT'; uci set firewall.@rule[-1].family='ipv4'

# nftset ipset for domain-based routing
uci add firewall ipset
uci set firewall.@ipset[-1].name='vpn_domains'
uci set firewall.@ipset[-1].match='dst_net'

# Mark rules for vpn_domains
uci add firewall rule
uci set firewall.@rule[-1].name='mark_domains_lan'
uci set firewall.@rule[-1].src='lan'
uci set firewall.@rule[-1].dest='*'
uci set firewall.@rule[-1].proto='all'
uci set firewall.@rule[-1].ipset='vpn_domains'
uci set firewall.@rule[-1].set_mark='0x1'
uci set firewall.@rule[-1].target='MARK'
uci set firewall.@rule[-1].family='ipv4'

uci add firewall rule
uci set firewall.@rule[-1].name='mark_domains_wg2'
uci set firewall.@rule[-1].src='wg2'
uci set firewall.@rule[-1].dest='*'
uci set firewall.@rule[-1].proto='all'
uci set firewall.@rule[-1].ipset='vpn_domains'
uci set firewall.@rule[-1].set_mark='0x1'
uci set firewall.@rule[-1].target='MARK'
uci set firewall.@rule[-1].family='ipv4'

# Cross-zone rule: wg2 -> wg
uci add firewall rule
uci set firewall.@rule[-1].name='wg2 -> wg0 allow'
uci set firewall.@rule[-1].src='wg2'
uci set firewall.@rule[-1].dest='wg'
uci set firewall.@rule[-1].family='ipv4'
uci add_list firewall.@rule[-1].proto='all'
uci set firewall.@rule[-1].target='ACCEPT'

# PBR firewall include
uci add firewall include
uci set firewall.@include[-1].type='script'
uci set firewall.@include[-1].path='/usr/share/pbr/firewall.include'
uci set firewall.@include[-1].fw4_compatible='1'

uci commit firewall
/etc/init.d/firewall restart
```

### Step 4.9: PBR (Policy-Based Routing)

```sh
uci set pbr.config.enabled='1'
uci set pbr.config.verbosity='2'
uci set pbr.config.strict_enforcement='1'
uci set pbr.config.resolver_set='dnsmasq.nftset'
uci add_list pbr.config.resolver_instance='*'
uci set pbr.config.ipv6_enabled='0'
uci add_list pbr.config.supported_interface='wg0'
uci add_list pbr.config.supported_interface='wg1'
uci add_list pbr.config.supported_interface='wg2'

# PBR interface: wg0
uci add pbr interface
uci set pbr.@interface[-1].interface='wg0'
uci set pbr.@interface[-1].gateway='10.0.0.2'
uci set pbr.@interface[-1].enabled='1'

# PBR policies
# VMs through Serbia (wg0)
uci add pbr policy
uci set pbr.@policy[-1].name='all through serbia'
uci set pbr.@policy[-1].src_addr='192.168.108.55 192.168.108.52 192.168.108.54 192.168.108.56'
uci set pbr.@policy[-1].interface='wg0'

# Direct WAN for specific users
uci add pbr policy
uci set pbr.@policy[-1].name='All through WAN'
uci set pbr.@policy[-1].src_addr='192.168.108.61 192.168.108.62 192.168.108.63'
uci set pbr.@policy[-1].interface='wan'

# wg1 clients through wg2
uci add pbr policy
uci set pbr.@policy[-1].name='wg1_to_wg2'
uci set pbr.@policy[-1].src_addr='10.0.1.12 10.0.1.11'
uci set pbr.@policy[-1].interface='wg2'

# PBR include: DNS fix (ISP hijack bypass)
uci add pbr include
uci set pbr.@include[-1].path='/usr/share/pbr/pbr.user.dns'
uci set pbr.@include[-1].enabled='1'

uci commit pbr
```

### Step 4.10: Restore custom files

```sh
# dnsmasq domain configs
mkdir -p /etc/dnsmasq.d
cp /tmp/backup/myipset.conf /etc/dnsmasq.d/
cp /tmp/backup/blocked.conf /etc/dnsmasq.d/
cp /tmp/backup/99-msftncsi.conf /etc/dnsmasq.d/

# PBR DNS fix script
cp /tmp/backup/pbr.user.dns /usr/share/pbr/pbr.user.dns
chmod +x /usr/share/pbr/pbr.user.dns

# Custom scripts
cp /tmp/backup/update-vpn-domains.sh /root/
chmod +x /root/update-vpn-domains.sh
cp /tmp/backup/tc-throttle.sh /root/
chmod +x /root/tc-throttle.sh

# DNS scripts directory
mkdir -p /root/dns
cp /tmp/backup/dns/* /root/dns/
```

### Step 4.11: Cron jobs

```sh
crontab -l > /tmp/cron.tmp 2>/dev/null || true
cat >> /tmp/cron.tmp << 'EOF'
# Weekly update VPN domains from v2fly
0 4 * * 0 /root/update-vpn-domains.sh

# Weekly update Telegram IP routes
0 4 * * 0 python3 /root/dns/update_telegram_routes.py >> /var/log/telegram-routes-update.log 2>&1
EOF
crontab /tmp/cron.tmp
```

### Step 4.12: Generate Telegram routes & restart all services

```sh
# Generate clean Telegram routes (instead of restoring duplicates)
python3 /root/dns/update_telegram_routes.py

# Generate v2fly domain list
/root/update-vpn-domains.sh

# Restart all services
/etc/init.d/network restart
/etc/init.d/firewall restart
/etc/init.d/dnsmasq restart
/etc/init.d/pbr restart
```

---

## Phase 5: Verification

### 5.1 Basic connectivity
```sh
ping -c 3 8.8.8.8          # WAN connectivity
ping -c 3 google.com        # DNS resolution
```

### 5.2 WireGuard
```sh
wg show                     # All interfaces should be up
wg show wg0                 # Check peer handshake
wg show wg2                 # Check Serbia peer handshake
```

### 5.3 Domain-based routing (test from LAN client!)
```sh
# On the router:
nft list set inet fw4 vpn_domains    # Should exist (may be empty until DNS queries)

# On a LAN client (not the router!):
# Browse to instagram.com — should work
# Then on router check:
nft list set inet fw4 vpn_domains    # Should show Instagram IPs
```

### 5.4 PBR
```sh
ip rule show                          # Check rules are in place
ip route show table vpn               # Should show default via wg0
ip route show table pbr_wan           # Should show DNS routes via wg2
```

### 5.5 DNS hijack fix
```sh
# From router:
nslookup instagram.com 8.8.8.8       # Should resolve (DNS goes through wg2)
```

### 5.6 WiFi
- Connect to Ayodhya, Ayodhya5G, Ayodhya-IoT — all should work
- Verify DHCP gives IPs in 192.168.108.x range

### 5.7 SSH remote access
```sh
# From local machine:
ssh -p 10822 -i ~/.ssh/aoydhya root@185.82.26.70
```

---

## Known Issues Cleaned Up During Migration

1. **Duplicate Telegram routes** (~70 duplicates removed): Will NOT be restored. After migration, run `python3 /root/dns/update_telegram_routes.py` once to add clean routes.

2. **Orphan forwarding rules**: Removed. Plan creates only necessary forwarding rules.

3. **OpenWRT 25 changes to watch for**:
   - Device/port naming may differ — verify `br-lan`, `br-wan` port names
   - nftables syntax changes — verify `ipset` firewall config still works
   - PBR package compatibility — check if pbr 1.2.0 works or needs update
   - dnsmasq nftset directive support — should be fine but verify

---

## Files Summary

### Config files to restore via UCI (Phase 4)
- `/etc/config/system`
- `/etc/config/dropbear`
- `/etc/config/network`
- `/etc/config/wireless`
- `/etc/config/dhcp`
- `/etc/config/firewall`
- `/etc/config/pbr`

### Custom files to copy manually
- `/etc/dropbear/authorized_keys`
- `/etc/iproute2/rt_tables`
- `/etc/dnsmasq.d/myipset.conf`
- `/etc/dnsmasq.d/blocked.conf`
- `/etc/dnsmasq.d/99-msftncsi.conf`
- `/usr/share/pbr/pbr.user.dns`
- `/root/update-vpn-domains.sh`
- `/root/tc-throttle.sh`
- `/root/dns/*` (whole directory)

### Packages to install
```
wireguard-tools kmod-wireguard luci-proto-wireguard
pbr luci-app-pbr
tc-full
luci luci-ssl luci-app-firewall luci-app-package-manager
python3 python3-urllib python3-light
```
