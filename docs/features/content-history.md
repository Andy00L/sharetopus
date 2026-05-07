# Content History

The `/posted` page displays all previously published content.

## Batch grouping

Posts are grouped by batch. Each batch represents a single create action that may have targeted multiple accounts or platforms. Clicking a batch opens a dialog showing per-platform publishing results and external "View post" links to the live content on each platform.

## Data source

Content history is stored in the `content_history` table, joined with `social_accounts` to display platform and account details.

## Status badges

| Badge | Meaning |
|-------|---------|
| **Posted** | Successfully published to the platform. |
| **In Progress** | Publishing is currently underway. |
| **Failed** | Publishing failed for this platform. |
| **Pending** | Waiting to be processed. |

---

[Back to features](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
