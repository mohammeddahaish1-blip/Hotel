---
name: nuzul-social-post
description: Make Instagram/social media posts for Nuzul (نُزُل) in the house style — a photorealistic scene generated in Figma, an Arabic headline with a gold highlight, two small "live" cards from the system, and the same brand bar on every post. Use when asked for a post, بوست, منشور, a social media image, an Instagram grid or a series of posts for Nuzul.
---

# Nuzul social posts

Every post is a 1080×1350 PNG (Instagram portrait) built in two steps:

1. **Photo** — generated in Figma with the user's free Starter AI credits. It holds no text.
2. **Everything written** — headline, subtitle, cards, logo, bottom bar — is laid out in HTML by
   `marketing/social/render.js` and rendered with Playwright. Image models garble Arabic, so no Arabic ever goes
   into the image prompt.

All posts live in `marketing/social/posts.json`; photos in `marketing/social/images/`; output in
`marketing/social/out/` (`<id>.png` and `grid.png`, the 3×3 profile preview).

## Making a post

1. **Write the copy first** and keep it true to the product: take features and wording from the product page
   (`src/app/page.tsx`, `src/components/landing/Showcase.tsx`). Do not promise features the system lacks.
   - `title`: two short lines; the second gets the gold box. About 18 characters per line at the default size;
     longer lines need `"size": 76`–`78`.
   - `sub`: one sentence, under about 60 characters.
   - `chips`: two cards, `{ "icon", "tone", "title", "note"? }`. `tone` is `ok` (green), `warn` (gold), `bad` (red)
     or `info` (teal). Icons are plain characters (✓ ! + → ↗ ↘ ◉ ٪ 1), never emoji: the renderer has no emoji font.
   - Figures on cards are illustrations; keep them plausible (Omani rials, units like 204, 305).
2. **Generate the photo in Figma** (file "Nuzul social posts", key `rz2b91SMQxCH88a5BmcXOO`, plan
   `team::1703121522433284867`). Call `create_session` on that file first, then `generate_image` with
   `model: "gemini-3.1-flash-lite-image"` (6 credits; the plan has 500 a month, 150 a day), `width: 1080`,
   `height: 1350`, and a prompt of the scene followed by this suffix, word for word:

   > Deep teal (#0d6b5f) and warm gold colour palette, cinematic warm light, shallow depth of field, premium look.
   > The top third of the frame is a calm, out-of-focus deep teal wall with no objects, leaving room for a headline.
   > Absolutely no text, letters, numbers, logos or watermarks anywhere.

   Start the scene with "Photorealistic commercial advertising photo, vertical 4:5." Set it in Oman (dishdasha and
   kuma, abaya and headscarf, dallah, dates, arches, majlis). Show a smartphone in the scene when it fits: the
   product runs on phones.
3. **Get the full-size photo.** The sandbox cannot download figma.com URLs (the proxy refuses the host). Instead
   call `get_screenshot` on the new node with `maxDimension: 1152` and `enableBase64Response: true`; the tool result
   names the PNG it saved under the session's `tool-results` folder. Copy that file to
   `marketing/social/images/<id>.png`.
4. **Find `cut`**: the model paints the empty top as a flat teal band that ends in a hard line. `cut` is where that
   line falls, in post pixels: `band end in the 1152-tall photo × 1350 / 1152`. Look at the photo to find it.
   The template keeps the area solid just past `cut` and moves photos whose scene starts above 480px down, so the
   headline never sits on a face.
5. **Add the post** to `posts.json` (keep the `prompt` there too, so the photo can be made again), then render:

   ```bash
   node marketing/social/render.js <id>        # one post
   node marketing/social/render.js             # every post and grid.png
   ```

6. **Look at the result** before showing it (Read the PNG). Check that the cards don't cover a face or the main
   object; cards go on the left by default, `"chipSide": "start"` puts them on the right (RTL: start is right).
   Then send it to the user with SendUserFile.

## Brand

Set once in `posts.json` → `brand`: tagline, the «صُنع في عُمان» tag, the offer (first month free, no card), the
site address and the call to action. The logo is the word «نُزُل» in Amiri; text is IBM Plex Sans Arabic (both
from Google Fonts, reachable from the sandbox). Colours: deep teal `#0e4643`, brand teal `#0d6b5f`, gold `#d9a531`.
Ask the user before adding a phone number, WhatsApp or social handles — none are known yet.
