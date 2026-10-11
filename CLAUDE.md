# Instructions for agents working in this repo

## Hard rule: no customer information in the repository

Never put customer information in anything that is committed or published from
this repo: commit messages, branch names, PR titles and descriptions, code
comments, log messages, test names, test fixtures, docs, SQL comments or any
other file. This repo may be public, and git history is permanent.

That covers:

- company, organisation, app or person names
- account, org, user, Stripe customer or subscription ids, API keys, emails
- the contents of a customer's requests: search terms, place or business
  names, coordinates, query strings, and anything else that would identify
  who they are or what they are building

Instead:

- describe incidents by shape and size ("a Free account made 109 country+name
  queries in three hours, 4.85 TiB"), never by who
- use obviously fake values in tests (`free-acct`, `paid-acct`, a generic
  place name, central-London coordinates)
- keep investigation notes that need customer detail in Notion or the
  claude.ai project, not here

If you find existing customer information while working, remove it in the
same change and say so. Do not add new instances "temporarily".

Stripe price ids and aggregate counts (for example "508 orgs on the Free
price") are not customer information.
