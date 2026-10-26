# Calls that connect anyway: the relay plan

**Status: WITHDRAWN (2026-10-26, chat's note CV).** Mike's ruling of 2026-09-08 stands: no relay server of the
project's. A call that cannot connect directly says so and points to a private network between your own devices
(private-network.html; DECISIONS.md, 2026-10-26). Kept as the record of what was weighed. If calls that fail directly
turn out to be most calls rather than a minority (they are now counted), this is where to start again.

*Originally:* a plan for Mike to decide on, not built (row 2.132, chat's note CU, 2026-10-26). Mike: *"Are other
people going to have these issues trying to make a call? Is this something we can fix instead of working around it?"*

**Provenance:** what the repo does is checked in the code, with file names. Cloudflare's credential API was checked
against its documentation today; the price is chat's, verified on Cloudflare's pricing page. Numbers marked
**[estimate]** are arithmetic, not measurements.

## Yes, other people will hit it

A call connects device to device (`call_transport.js`). Each end offers the addresses it can be reached at:
- its home-network address;
- its internet address, found with a free STUN server.

The ends try each pair, and two cases fail:
- **The two ends are on different networks and one of them is behind a strict NAT.** Mobile data is usually behind
  one (carrier-grade NAT), and many facility and guest Wi-Fi networks are too. Neither end can reach the other's
  internet address.
- **Both ends are on one network, but one of them didn't offer its home address,** and the router won't loop
  traffic back to itself ("hairpin").

Either way, no pair works, and today the call says "could not connect". There is no relay: `iceServers()` takes a
`turn` list, and nothing fills it.

**A TURN relay is the standard fix.** When no direct pair works, both ends send to the relay, which passes the
packets on. The media is still encrypted end to end between the two devices (WebRTC's DTLS-SRTP), so the relay
carries it without being able to see or hear it. DECISIONS.md already allows exactly this ("TURN relays *encrypted*
media"). Calls that can go direct still go direct: the relay is only the last pair tried.

This is not `call_relay.py`. That file is about a media server for *bigger* group calls (a LiveKit-style SFU). This
plan is about ordinary calls connecting at all. They can share a settings page later; they are different machines.

## 1. A project relay on Cloudflare Realtime TURN (recommended)

**What it costs:** the first 1,000 GB a month free, then $0.05 per GB (chat, from the pricing page).
- **[estimate]** A video call at about 1.5 Mbit/s each way is about 1.4 GB an hour through the relay.
- So the free amount is roughly **700 hours of relayed video a month**, and only calls that can't go direct use it.

**How it works** [Cloudflare's docs, checked]:
- The site holds one long-lived TURN key (an id and an API token) as server secrets (Render environment variables),
  never sent to a page.
- For each call, our server asks Cloudflare for **short-lived credentials**:
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/<key id>/credentials/generate-ice-servers` with
  `Authorization: Bearer <token>` and `{"ttl": <seconds>}`. The answer is a list of relay addresses with a username
  and password that expire.
- They can be revoked early: `POST .../credentials/<username>/revoke`.

**Who gets credentials:** a new route, `POST /api/call/relay/<person>`. It answers only somebody the server already
lets into a call with that person:
- the owner, a granted caller whose "May call" is on, or one of that person's own screens;
- the same checks as a ring (app.py `_may_call`, `_may_drive`).

The page puts the answer into `config.turn`, and `iceServers()` already adds it after STUN. Nobody else ever sees a
credential.

**How long they last:** **[default, Mike's to change]** three hours. Cloudflare's guidance is "longer than users are
expected to need TURN"; three hours covers a long call, and a fresh one is asked for on the next call.

**One technical detail from Cloudflare's docs:** some browsers block their port-53 relay address, and without
"trickle" (our calls gather every address before sending, `call_transport.js`) a blocked address can hold gathering
up. So the server drops the port-53 address before handing the list out.

**A monthly cap, and what it says:** **[default, Mike's to change]** stop handing out relay credentials at 900 GB in
a month. Calls then try direct only, and when direct fails the page says:

> "This call could not connect directly, and the relay is paused until the 1st (this month's free amount is used
> up)."

How the server knows the month's usage: Cloudflare's analytics **[to verify: the TURN usage figure and how to read
it]**, read once an hour. If it can't be read, the cap is counted from our own records of relayed calls (section 3)
times the estimate above, erring early.

**Why this one:** nothing for a household to set up, and it fixes the case Mike hit for everybody. Against it: it is
the project's bill above the free amount, and a key that has to be kept secret. The cap and the per-call credentials
are the answer to both.

## 2. A household's own relay, for anyone who wants it

Some households will want calls to use only their own equipment. A per-account setting gives them that.
- **What they enter:** a TURN address and its credentials, either their own `coturn` server or their own Cloudflare
  key.
- **Where it is kept:** sealed with `claude_ai.KeyBox` (as the Claude and search keys are) and handed out only by the
  same route, to the same people.
- **Precedence:** when a household has its own relay, its calls use that instead of the project's.
- **The settings page:** call.html already has a "relay server (advanced)" section saying "not built yet". It
  becomes this.

## 3. Saying when a call went through the relay, and counting

When a call connects, the page reads the connection's own stats (the same reading `summarizeIce` does for a failed
call, public bd96bd5).
- **The chosen pair's address types say whether it went direct or through the relay.**
- **On the page:** a small line under the call, "Connected through the relay" (nothing when it's direct). The person
  doesn't need to act on it, but it explains a slower call.
- **Counted:** one record per call to a new route: direct, relay, or could not connect, plus the address types each
  end offered. No names, no content, no addresses. A daily count shows how often direct fails and which networks it
  fails on.
- The failure words from bd96bd5 stay either way, so a home-network failure is still explained relay or not (CT).

## Order of work, once Mike decides

1. **Mike:** make a Cloudflare account and a TURN key, and put the key id and token in Render's environment.
   Credentials are his; Code doesn't handle them.
2. The credentials route and the page asking for it (tested against a pretend Cloudflare, like the pretend Home
   Assistant).
3. Counting (section 3), so the cap has our own figure as well.
4. The cap and its message.
5. The household's own relay (section 2).

## Mike's decisions

- The project relay on Cloudflare: yes or no.
- The cap, 900 GB a month (the free amount minus a margin).
- Credentials lasting three hours.
- Whether "Connected through the relay" shows on the screen side too, or only on the caller's.
