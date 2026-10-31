# Cert Trends snapshot

Files `jobs.json`, `roles.json` and `certifications.json` were downloaded unmodified from the
public static data endpoint of the Cert Trends project (https://cert-chart.vercel.app/data/)
on 2026-10-31. They are real observations collected by that project (each job keeps its
original source name and URL). CareerPilot uses this snapshot only:

- in automated tests (no network access), and
- as an explicit, labeled offline import when the live endpoint is unreachable.

Live sync always fetches from `CERT_TRENDS_BASE_URL`.
