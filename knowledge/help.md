# How-to topics for the AIxia site assistant

<!--
Each "## " heading is one topic. The comment under it says where it applies:

  page:     home | blog | any
  section:  a section id on that page (home, projects, about, contact, blog),
            several separated by commas, or "any"
  actions:  optional "Show me" steps, run in order when the visitor clicks:
              scroll:<section id>      scroll that section into view
              highlight:<target>       briefly outline a named element
              open:<target>            open resume, blog or home
            Targets are defined in TARGETS in assistant.js. Anything else is
            ignored by the widget.

AIxia only gives steps that appear here, so keep them accurate when the site
changes. Run `npm run knowledge` to check the file parses.
-->

## Download Vince's résumé
<!-- page: home; section: about; actions: scroll:about, highlight:resume -->
1. Scroll to the About section.
2. Select the Resume card, the one that says "Download PDF".
3. The PDF downloads straight away. No sign-up or email is needed.

## Send Vince a message
<!-- page: home; section: contact; actions: scroll:contact, highlight:contact-form -->
1. Scroll to the Contact section at the bottom of the page.
2. Fill in your name, your email address and your message.
3. Select "Send message". A confirmation appears at the bottom of the screen.
The message goes straight to Vince's inbox; no email app opens. If sending fails, use the email icon next to the form instead.

## See a project's source code
<!-- page: home; section: projects; actions: scroll:projects, highlight:projects -->
1. Find the project card in the Projects section.
2. Select "View repository" on that card.
The code opens on GitHub in a new tab.

## Try AIxia live
<!-- page: home; section: projects; actions: scroll:projects, highlight:aixia -->
1. Find the AIxia card, the first and largest card in the Projects section.
2. Select "Talk to AIxia".
The full AIxia app opens in a new tab. It answers questions about Vince's background with sources, and has a voice mode and a general chat mode that this assistant does not.

## Find Vince on GitHub or LinkedIn
<!-- page: home; section: home, contact; actions: highlight:social -->
The round GitHub, LinkedIn and email icons sit under the introduction at the top of the page and again in the Contact section. Select one to open his profile in a new tab, or to start an email.

## Read the blog
<!-- page: home; section: any; actions: open:blog -->
Select "Blog" in the navigation bar at the top of the page. On a phone, open the menu first with the two-line button in the top-right corner.

## Filter blog posts by topic
<!-- page: blog; section: blog; actions: scroll:blog, highlight:blog-filters -->
1. Scroll to the list of posts.
2. Select a tag button above the posts, such as "career", to show only posts with that tag.
3. Select "All" to see every post again.

## Get back to the home page from the blog
<!-- page: blog; section: any; actions: open:home -->
Select Vince's name and logo at the top left of the page, or any link in the navigation bar such as "Projects".

## Open the menu on a phone
<!-- page: any; section: any; actions: highlight:menu -->
On a narrow screen the navigation links are folded away. Tap the round button with two lines in the top-right corner to open the menu, and tap a link to jump to that section.

## Where to find things on this site
<!-- page: any; section: any -->
The home page has four sections, in this order:
- Introduction, at the top: who Vince is, and links to his GitHub, LinkedIn and email.
- Projects: a card for each project, with links to its code.
- About: his background, education, toolkit, and the résumé download.
- Contact, at the bottom: a form for sending him a message, plus email and profile links.
The Blog is a separate page, linked in the navigation bar, with posts that can be filtered by tag.

## What this assistant can help with
<!-- page: any; section: any -->
AIxia answers questions about what is on your screen right now: the section you are reading, the project card or blog post in view, background from Vince's CV that relates to it, and how to do things in that section. It cites where each answer comes from. It does not answer general questions, and it can be wrong, so check anything important against the page itself.
