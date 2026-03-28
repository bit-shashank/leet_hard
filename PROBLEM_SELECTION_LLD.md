# Room Problem Selection LLD

## Purpose
This document explains how problems are selected when a room auto-starts, and how filters interact.

## Data Sources
- Problem pool by difficulty (Easy/Medium/Hard) from the LeetCode API `/problems/filter`.
- Topic catalog from LeetCode API `/tags`.
- Topic problem lists from LeetCode API `/problems/tag/{tag_slug}`.
- Sheet slugs from `app/services/problem_sheets.py` for curated sources.
- Recent submissions for each participant (used for pre-solved exclusion).

## Caches
- `_POOL_CACHE`: problem pool per difficulty, TTL 1 hour.
- `_TOPIC_CACHE`: topics list, TTL 1 hour.
- `_TAG_PROBLEM_CACHE`: problem slugs per topic tag, TTL 1 hour.

## Inputs
- `problem_source`: `random` or a sheet source.
- `easy_count`, `medium_count`, `hard_count`.
- `topic_slugs`: optional, OR-match semantics across topics.
- `exclude_pre_solved`: optional.

## High-Level Flow
- Auto-start triggers `_maybe_auto_start_room`.
- `_maybe_auto_start_room` calls `_activate_room` when scheduled time has passed.
- `_activate_room` selects problems using `choose_random_problems_by_source`.

## Filter Order and Interaction
- Topic filter applies first by converting topic slugs to a union set of allowed problem slugs.
- Sheet source filter applies by limiting candidates to the sheet slug set.
- Pre-solved filter excludes previously solved slugs if enabled.
- Difficulty mix picks the requested counts per difficulty.

## Selection Algorithm
### Random Source
- Build `topic_problem_slugs` by calling `/problems/tag/{tag_slug}` for each topic and unioning results.
- For each difficulty in (Easy, Medium, Hard):
- Fetch the difficulty pool from `_POOL_CACHE`.
- Filter by `topic_problem_slugs` if topics are selected.
- Filter by `excluded_slugs` if pre-solved exclusion is enabled.
- Sample `count` from the remaining pool.
- Shuffle final selection.

### Sheet Sources
- Build `sheet_slugs` from the sheet definition.
- Build `topic_problem_slugs` if topics are selected.
- Scan the difficulty pools and collect problems that:
- Are in `sheet_slugs`.
- Are not in `excluded_slugs`.
- Are in `topic_problem_slugs` when topics are selected.
- If total candidates are less than requested total, raise `ProblemSelectionError`.
- Select per-difficulty counts where possible, then fill remaining from any leftover candidates.
- Shuffle final selection.

## Pre-Solved Handling
- When `exclude_pre_solved` is enabled, we collect solved slugs from participant submissions.
- If selection fails due to lack of unsolved problems, we retry once without pre-solved exclusion.
- Topic filtering is still enforced on retry.

## Errors and Recovery
- `ProblemSelectionError` during auto-start becomes a room `sync_warning` and the room stays in lobby.
- `LeetCodeServiceError` during auto-start becomes a room `sync_warning` and the room stays in lobby.
- Topic catalog failures return HTTP 503 on `/api/v1/rooms/topics`.

## LLD: Components
```
[Room Auto-Start]
  -> _maybe_auto_start_room
  -> _activate_room
      -> choose_random_problems_by_source
          -> (Random) choose_random_problems_by_difficulty
          -> (Sheet) get_sheet_slugs + pool scan
      -> RoomProblem records saved
```

## LLD: Sequence (Auto-Start)
```
Time tick or room fetch
  -> _maybe_auto_start_room
    -> _activate_room
      -> collect pre-solved (optional)
      -> build topic problem slugs (optional)
      -> select problems
      -> persist RoomProblem list
      -> set room status ACTIVE
```

## Notes and Assumptions
- Topic counts from `/tags` may include paid problems; selection filters out paid-only problems when building topic slugs.
- Topics are OR-matched, not AND-matched.
- Total problem count must be between 3 and 10.

## Reference Files
- `backend/app/services/leetcode.py`
- `backend/app/routers/rooms.py`
- `backend/app/services/problem_sheets.py`
