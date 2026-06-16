---
project: "VaultView"
version: 1
status: draft
created: 2026-06-12
updated: 2026-06-16
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: VaultView

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Portfele kryptowalutowe są rozproszone po wielu giełdach i portfelach — brak jednego widoku na skonsolidowane pozycje i P&L. VaultView rozwiązuje to tagując GDZIE fizycznie znajduje się każdy asset (giełda, portfel, cold storage) jako pierwszorzędny koncept, łącząc to z atomowym zapisem swapów i auto-wypełnianiem sell-all. Żaden istniejący tracker nie łączy konsolidacji z uwzględnieniem lokalizacji z bezproblemowym wprowadzaniem transakcji.

## North star

**S-01: Użytkownik dodaje handel (BUY/SELL/SWAP) i widzi portfolio z P&L** — najmniejszy przekrojowy slice, którego udane dostarczenie dowodzi, że dwustronny model handlu crypto-to-crypto z lokalizacjami i wycenami z API cenowego daje użytkownikowi kompletny obraz pozycji. Umieszczony najwcześniej jak pozwalają zależności, ponieważ cała reszta roadmapy buduje na tym fundamencie.

> Gwiazda przewodnia (north star) to najmniejszy przekrojowy slice (przechodzący przez UI, logikę biznesową i dane), którego udane dostarczenie potwierdza główną hipotezę produktu — umieszczony najwcześniej jak pozwalają zależności, bo bez niego reszta roadmapy nie ma sensu.

## At a glance

| ID   | Change ID                | Outcome (user can …)                                                         | Prerequisites | PRD refs                                             | Status   |
| ---- | ------------------------ | ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- | -------- |
| F-02 | transaction-schema-rls   | (foundation) tabela transakcji z RLS zapewniającym izolację danych           | —             | NFR (data isolation, data retention)                 | done     |
| S-01 | core-trade-and-portfolio | dodaje BUY/SELL/SWAP z lokalizacją i widzi portfolio z P&L                   | F-02          | US-01, US-02, FR-003, FR-007, FR-008, FR-012, FR-013 | done     |
| S-02 | per-buy-pnl-breakdown    | przegląda P&L w trybie per-buy (każdy zakup jako osobna pozycja)             | S-01          | FR-009                                               | proposed |
| S-03 | summary-dashboard        | widzi dashboard: łączny realized P&L, unrealized P&L, opłaty                 | S-01          | FR-010                                               | proposed |
| S-04 | transaction-list-filters | przegląda listę transakcji z filtrami po typie, lokalizacji i assecie        | S-01          | FR-011                                               | proposed |
| S-05 | deposit-historical-cost  | rejestruje istniejący asset (DEPOSIT) z historycznym kosztem nabycia         | S-01          | US-04, FR-005                                        | proposed |
| S-06 | withdraw-cash-out        | wycofuje asset z trackingu (WITHDRAW) z realizacją P&L                       | S-01          | US-05, FR-006                                        | proposed |
| S-07 | sell-all-single-location | sprzedaje całą pozycję w jednej lokalizacji jednym kliknięciem               | S-01          | US-03, FR-004                                        | done     |
| S-08 | sell-all-global          | sprzedaje asset we wszystkich lokalizacjach z per-lokalizacyjną konfiguracją | S-07          | FR-004                                               | done     |

## Streams

Pomoc nawigacyjna — grupuje pozycje o wspólnym łańcuchu zależności. Kanoniczne uporządkowanie to graf zależności w sekcjach Foundations + Slices; ta tabela pokazuje proponowaną kolejność czytania.

| Stream | Theme              | Chain                    | Note                                                           |
| ------ | ------------------ | ------------------------ | -------------------------------------------------------------- |
| A      | Rdzeń handlu       | `F-02` → `S-01`          | Gwiazda przewodnia; cała reszta zależy od S-01.                |
| B      | Widoki portfolio   | `S-02` / `S-03` / `S-04` | Równoległe po S-01; kompletują experience przeglądania danych. |
| C      | Dodatkowe operacje | `S-05` / `S-06`          | Po S-01; rozszerzają model o DEPOSIT i WITHDRAW.               |
| D      | Sell-all           | `S-07` → `S-08`          | Po S-01; sell-all w lokalizacji → sell-all globalny.           |

## Baseline

Stan bazy kodu na 2026-06-12 (auto-researched + potwierdzone przez użytkownika).
Foundations poniżej zakładają że te warstwy są obecne i NIE budują ich od nowa.

- **Frontend:** present — Astro 6 + React 19, Tailwind CSS 4, shadcn/ui infrastruktura, strony auth + dashboard
- **Backend / API:** partial — Astro SSR z Cloudflare adapterem, 3 endpointy auth (signin/signup/signout), brak logiki biznesowej
- **Data:** partial — Supabase JS client zainstalowany, brak schematów, migracji i tabel poza auth.users
- **Auth:** present — email/password auth w pełni zaimplementowane (signin/signup/signout API routes, cookie-based sessions via @supabase/ssr, middleware z protected routes, strony UI). FR-001 i FR-002 spełnione.
- **Deploy / infra:** partial — Cloudflare adapter + wrangler deploy + GitHub Actions CI; wystarczające dla MVP
- **Observability:** absent — brak logowania, error tracking, metryk; PRD nie wymaga tego w MVP
- **API cenowe:** decided — **CoinPaprika** (oficjalne REST API, bez klucza, 20K calls/miesiąc free tier, ceny bieżące + historyczne + wyszukiwanie assetów). Wybrane zamiast CoinGecko (zablokowane w sieci) i Yahoo Finance (nieoficjalne endpointy).

## Foundations

### F-02: Transaction schema + RLS

- **Outcome:** (foundation) tabela `transactions` w Supabase z polami dla dwustronnych handli i operacji jednostronnych; RLS policies gwarantują że użytkownik widzi tylko swoje dane.
- **Change ID:** transaction-schema-rls
- **PRD refs:** NFR (data isolation, data retention), Access Control
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08 (każdy slice operuje na danych transakcji)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Schemat musi pomieścić 5 typów transakcji (BUY/SELL/SWAP dwustronne, DEPOSIT/WITHDRAW jednostronne) w jednej strukturze. Błąd w modelu danych na tym etapie kosztuje migrację w każdym późniejszym slice.
- **Status:** done

## Slices

### S-01: Handel (BUY/SELL/SWAP) + portfolio z P&L

- **Outcome:** użytkownik dodaje transakcję BUY, SELL lub SWAP jako dwustronny handel (source → target asset) z ceną sugerowaną przez API cenowe, opłatą, datą, lokalizacją — i widzi skonsolidowane portfolio z kosztem średnim, ceną bieżącą, unrealized P&L per asset, z rozbiciem per-lokalizacja; ceny odświeżają się automatycznie co 15–30 s.
- **Change ID:** core-trade-and-portfolio
- **PRD refs:** US-01, US-02, FR-003, FR-007, FR-008, FR-012, FR-013
- **Prerequisites:** F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Największy slice w roadmapie — łączy formularz transakcji, integrację z CoinPaprika API, silnik P&L (Average Cost), widok portfolio z auto-refresh i zarządzanie lokalizacjami. Rozmiar uzasadniony tym, że te elementy tworzą jeden nierozerwalny przepływ użytkownika: dodanie handlu bez widoku portfolio jest nieweryfikowalne. Główne ryzyko: silnik P&L musi być arytmetycznie poprawny od pierwszej wersji (PRD §Guardrails).
- **Status:** done

### S-02: Per-buy P&L breakdown

- **Outcome:** użytkownik przełącza widok portfolio na tryb per-buy, gdzie każdy zakup jest traktowany jako osobna pozycja (jak pozycje futures na giełdzie) z własnym kosztem nabycia i P&L.
- **Change ID:** per-buy-pnl-breakdown
- **PRD refs:** FR-009
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wymaga przechowywania lub rekonstrukcji poszczególnych lotów zakupowych — Average Cost agreguje, per-buy rozbija. Silnik P&L z S-01 musi być zaprojektowany tak, by dane per-buy były dostępne.
- **Status:** proposed

### S-03: Summary dashboard

- **Outcome:** użytkownik widzi dashboard z łącznymi wartościami: total realized P&L, total unrealized P&L, total opłaty. Flat totals — bez wykresów czasowych.
- **Change ID:** summary-dashboard
- **PRD refs:** FR-010
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niski — agregacja danych już obliczanych przez silnik P&L z S-01.
- **Status:** proposed

### S-04: Lista transakcji z filtrami

- **Outcome:** użytkownik przegląda listę wszystkich transakcji z możliwością filtrowania po typie (BUY/SELL/SWAP/DEPOSIT/WITHDRAW), lokalizacji i assecie.
- **Change ID:** transaction-list-filters
- **PRD refs:** FR-011
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niski — standardowy widok listy z filtrami. Przy skali MVP indeksy bazodanowe nie są potrzebne.
- **Status:** proposed

### S-05: DEPOSIT z historycznym kosztem nabycia

- **Outcome:** użytkownik rejestruje istniejący asset (kupiony wcześniej poza trackerem) podając datę zakupu; aplikacja pobiera historyczną cenę z API cenowego jako cost basis, a portfolio pokazuje unrealized P&L dla zdeponowanego assetu.
- **Change ID:** deposit-historical-cost
- **PRD refs:** US-04, FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wymaga endpointu CoinPaprika dla cen historycznych (inny niż bieżące ceny z S-01). Free tier 20K calls/miesiąc powinien wystarczyć dla personal trackera.
- **Status:** proposed

### S-06: WITHDRAW (cash-out z realizacją P&L)

- **Outcome:** użytkownik wycofuje asset z trackingu (exit z crypto); wycofana ilość jest usuwana z lokalizacji, realized P&L jest obliczany i zapisywany, portfolio odzwierciedla zmniejszoną pozycję.
- **Change ID:** withdraw-cash-out
- **PRD refs:** US-05, FR-006
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Mechanizm wyceny WITHDRAW — po jakiej cenie realizować P&L? Bieżąca cena rynkowa czy podana przez użytkownika? — Owner: user. Block: no (domyślnie: cena rynkowa z API cenowego w momencie WITHDRAW).
- **Risk:** Open Question z PRD (mechanizm wyceny) jest nieblokujący — domyślna implementacja (cena rynkowa) jest rozsądna i może być zmieniona bez przebudowy.
- **Status:** proposed

### S-07: Sell-all w pojedynczej lokalizacji

- **Outcome:** użytkownik tworząc handel SELL wybiera "sell all" — ilość źródłowa auto-wypełnia się pełnym holdingiem w wybranej lokalizacji; po zatwierdzeniu realized P&L odzwierciedla zamknięcie pełnej pozycji.
- **Change ID:** sell-all-single-location
- **PRD refs:** US-03, FR-004
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niski — rozszerzenie formularza handlu z S-01 o przycisk auto-fill. Wymaga precyzyjnej kalkulacji holdingu per lokalizacja.
- **Status:** done

### S-08: Sell-all globalny (wszystkie lokalizacje)

- **Outcome:** użytkownik sprzedaje cały holding assetu we wszystkich lokalizacjach jedną operacją, z możliwością konfiguracji target assetu i opłaty per lokalizacja (np. BTC na Binance → USDT, BTC na MetaMask → ETH).
- **Change ID:** sell-all-global
- **PRD refs:** FR-004
- **Prerequisites:** S-07
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Najbardziej złożony UX w roadmapie — wielolokalizacyjna konfiguracja w jednym formularzu. Sekwencjonowany jako ostatni ponieważ jest rozszerzeniem S-07 i odpowiada wtórnemu kryterium sukcesu PRD.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                | Suggested issue title                     | Ready for `/10x-plan` | Notes                                               |
| ---------- | ------------------------ | ----------------------------------------- | --------------------- | --------------------------------------------------- |
| F-02       | transaction-schema-rls   | Utwórz schemat transakcji z RLS           | done                  | Implemented — `de6aed5`, `5577087`                  |
| S-01       | core-trade-and-portfolio | Handel BUY/SELL/SWAP + portfolio z P&L    | done                  | Implemented — `bf767fc`..`f2705e3`                  |
| S-02       | per-buy-pnl-breakdown    | Widok P&L per-buy breakdown               | yes                   | S-01 done. Run `/10x-plan per-buy-pnl-breakdown`   |
| S-03       | summary-dashboard        | Dashboard z łącznymi P&L i opłatami       | yes                   | S-01 done. Run `/10x-plan summary-dashboard`        |
| S-04       | transaction-list-filters | Lista transakcji z filtrami               | yes                   | S-01 done. Run `/10x-plan transaction-list-filters` |
| S-05       | deposit-historical-cost  | DEPOSIT z historycznym kosztem nabycia    | yes                   | S-01 done. Run `/10x-plan deposit-historical-cost`  |
| S-06       | withdraw-cash-out        | WITHDRAW z realizacją P&L                 | yes                   | S-01 done. Run `/10x-plan withdraw-cash-out`        |
| S-07       | sell-all-single-location | Sell-all w pojedynczej lokalizacji        | done                  | Implemented — `ac06f82`..`0123bf3`                  |
| S-08       | sell-all-global          | Sell-all globalny (wszystkie lokalizacje) | done                  | Implemented — `6d5d344`..`ee8c2f0`                  |

## Open Roadmap Questions

1. **Mechanizm wyceny WITHDRAW** — Gdy użytkownik wycofuje asset, P&L jest realizowany. Po jakiej cenie? Bieżąca cena rynkowa w momencie WITHDRAW czy podana przez użytkownika? Owner: user. Block: S-06 (nieblokujące — domyślna implementacja używa ceny rynkowej).

## Parked

- **Wsparcie walut fiat (PLN/USD)** — Why parked: PRD §Non-Goals. Stablecoiny pełnią rolę "gotówki".
- **Automatyczny import z giełd** — Why parked: PRD §Non-Goals. Wszystkie transakcje wprowadzane ręcznie w MVP.
- **Alerty cenowe i powiadomienia** — Why parked: PRD §Non-Goals. Brak push/email/alertów w MVP.
- **Metody FIFO/LIFO** — Why parked: PRD §Non-Goals. Average Cost jedyną metodą w MVP.
- **Layout mobilny** — Why parked: PRD §Non-Goals. Desktop only w MVP.
- **Panel administracyjny** — Why parked: PRD §Non-Goals. Zarządzanie użytkownikami i statystyki odroczone do v2.
- **Auth email/password** — Why parked: PRD §Non-Goals. Google OAuth jedyną metodą w MVP.

## Done

- **S-08: sprzedaje asset we wszystkich lokalizacjach z per-lokalizacyjną konfiguracją** — Archived 2026-06-16 → `context/archive/2026-06-16-sell-all-global/`. Lesson: —.
