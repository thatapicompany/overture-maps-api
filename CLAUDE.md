# Instructions for agents working in this repo

## Hard rule: no customer or business information in the repository

This is a public, open-source repository. Everything committed or published
from it, including git history and PR descriptions, is readable by anyone and
is effectively permanent.

Never put customer information or internal business information in anything
that is committed or published from this repo: commit messages, branch names,
PR titles and descriptions, code comments, log messages, test names, test
fixtures, docs, SQL comments or any other file.

Customer information covers:

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

Internal business information covers:

- revenue, MRR, pricing deals, customer counts or plan mix
- spend figures and cost shares tied to accounts or to the business
- outreach, CRM or sales detail, and who was contacted about what
- configuration of our hosted service: Stripe price ids, Firebase or other
  project ids for private systems, service account emails, secrets of any
  kind. Read these from env and document them in `.env.example` with
  placeholder values.

Public facts are fine: published plan limits, the data schema, BigQuery bytes
scanned by a query shape, and the names of the public GCP resources the code
already references.
