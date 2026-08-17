# MedApex

MedApex is a medical question bank and exam-prep platform built for students following the Algerian medical curriculum (Externat Alger, P1–P6 rotations, Rattrapage, Résidanat). It provides structured QCM (multiple-choice question) content across rotations — cardiology, pulmonology, pharmacology, neurology, and more — with detailed French-language explanations for each answer.

## Features

- Rotation- and year-based question banks (QCMs) with detailed explanations
- Structured content covering major medical specialties
- Exam-style practice aligned with the Algerian medical curriculum

## Tech Stack

- **Frontend**: Vite + React (TanStack Start)
- **Backend**: Supabase (database, auth)
- **Deployment**: Vercel

## Getting Started

```bash
npm install
npm run dev
```

Create a `.env` file with the required Supabase environment variables (see `.env.example` if present, or check `src/integrations/supabase/client.ts` for the expected variable names).

## Development

```bash
npm run build   # production build
npm run dev     # local dev server
```
