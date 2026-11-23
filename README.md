# AURA · Enterprise Vendor Intelligence OS

> *"Simplicity is the ultimate sophistication."* — Designed for Global Industry & Vendor Risk Management.

A modern enterprise SaaS vendor qualification and onboarding platform built with a Steve Jobs Cupertino aesthetic. Takes complex multi-jurisdictional vendor submissions and returns **approved**, **pending**, or **rejected**, with complete reasoning across 33 automated controls, AI document/OCR verification, treasury anti-fraud (BEC) interception, and immutable governance audit trails.

```bash
node --test tests.js        # 38 tests, 100% pass rate
node build-ui.js            # builds dist/vendor-onboarding-desk.html (self-contained 237 KB SaaS app)
```

---

##  Steve Jobs Cupertino Design System

- **Craftsmanship & Materiality**: Frosted glass navigation bars (`backdrop-filter: blur(28px)`), Cupertino squircle curvatures (`border-radius: 14px – 24px`), hairline borders, and pure Apple Aluminum (`#F5F5F7`) / Space Black (`#000000`) colorways.
- **Spotlight Search (`⌘K` / `Ctrl+K`)**: Floating Spotlight palette to search any vendor, tax ID, or action across the entire enterprise portfolio.
- **Micro-Interactions & Audio**: Pure Web Audio API synthesized glass chimes for clearances, approvals, and actions.
- **Executive Certificate of Qualification**: Museum-grade compliance certificate modal ready to export or print with official digital seal and verification hash.

---

## 🏭 Multi-Industry Scope & Standards

The platform includes tailored presets and compliance controls for key enterprise sectors:

| Industry Vertical | Key Standards & Compliance Controls | Typical Risk Scenario |
|---|---|---|
| **⚡ Enterprise Tech & Cloud** | SOC 2 Type II, ISO 27001, GDPR Sub-processor | Tessera Analytics (`S0`), Crestwave Cloud (`E2`) |
| **🏭 Manufacturing & Print** | ISO 9001:2015, OSHA 18001, FSC Chain of Custody | Lakeshore Print Co (`S1`), Apex Robotics (`INTAKE`) |
| **🌐 Global Trade & Commodities** | OFAC Sanctions Screening, FATF Enhanced Due Diligence | Sahin Kavak Trading (`S2`) |
| **🛍️ Sustainable Retail & Goods** | Fair Trade Ethical Sourcing, ISO 14001 ESG | Harbor & Pine (`S3`) |
| **🎨 Creative & Agency Services** | Statutory Tax Exemption §22, IP Assignment Covenants | Pixelcraft Studio (`E1a`, `E1b`) |
| **🚢 Maritime & Heavy Infrastructure** | IMO Safety, Cross-Jurisdictional Watchlists | Northgate Maritime (`E3`) |
| **📦 Freight & Supply Chain Logistics** | Anti-BEC Treasury Defense, Out-of-band Callback Mandates | Brightline Logistics (`E4a`, `E4b`) |
| **🧬 Life Sciences & Healthcare** | FDA 21 CFR Part 11, GxP Qualified, ISO 13485 | BioGenix Clinical Labs (`INTAKE`) |
| **⚡ Clean Energy & Utilities** | Critical National Infrastructure Clearances, Net-Zero ESG | Solaria Clean Power (`INTAKE`) |

---

## 🎯 Analyst & Vendor Management Workflows

1. **Executive Pulse Bar**: Real-time KPI metrics showing active pipeline volume, human sign-offs, BEC fraud alerts, auto-approval rates, payments on hold, and mean onboarding cycle time (1.4 days).
2. **Finder Queue Panel**: Multi-vertical filtering, quick search, SLA risk tags, country flags, and status tabs (`All`, `⚠️ Urgent`, `Pending`, `Approved`, `Declined`).
3. **Hero Verdict Banner**: Instant executive decision clarity (`APPROVED`, `PENDING`, `REJECTED`) with plain-language rationale.
4. **Document & OCR Inspector**: Side-by-side view comparing uploaded physical artifacts (PAN, COI, GST, Cheques, W-9, Bank Letters) with AI-extracted OCR fields, expiry dates, and tamper checks.
5. **Bank Anti-Fraud Shield (Anti-BEC)**: Visual account-swap diffing, lookalike domain alerts, pressure language detection, and telephone callback logger.
6. **33 Controls Trace**: Check-by-check evidence inspector across 8 categories (Completeness, Format, Consistency, Documents, Verification, Exemption, Risk, Lifecycle) with JSON evidence.
7. **New Vendor Intake Simulator**: Self-service onboarding wizard with 1-click industry templates to test any new vendor against all 33 controls.
8. **Time Machine Stepper**: Simulate lifecycle milestones (`+1d`, `+7d`, `+30d`) with automated day-7/14 reminders, day-30 closures, and 60-day reopening windows.

---

## Architecture & Codebase

- `engine.js`: Pure JS rule engine (33 rules, CaseStore, evaluate, validators, formatting; zero dependencies).
- `scenarios.js`: Realistic multi-industry scenarios, tax registries, and vendor master data.
- `ui.src.html`: Cupertino design system styles, typography, and responsive grid layouts.
- `ui.js`: Vanilla JS reactive workspace, Spotlight search, audio synthesis, and analyst toolset.
- `build-ui.js`: Bundles the standalone HTML file (`dist/vendor-onboarding-desk.html`).
- `tests.js`: 38 automated test cases covering happy path, validation checksums, and edge cases.
