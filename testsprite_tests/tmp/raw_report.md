
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** sharetopus
- **Date:** 2026-03-15
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Landing page loads and key marketing sections are visible
- **Test Code:** [TC001_Landing_page_loads_and_key_marketing_sections_are_visible.py](./TC001_Landing_page_loads_and_key_marketing_sections_are_visible.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/281ed589-cb8a-410f-abb6-b77b06847abb
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Pricing section is reachable and displays plan information
- **Test Code:** [TC002_Pricing_section_is_reachable_and_displays_plan_information.py](./TC002_Pricing_section_is_reachable_and_displays_plan_information.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/3ecbf28c-4b7d-43ad-8978-f9b784b09d39
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 Toggle between monthly and yearly pricing updates the pricing view
- **Test Code:** [TC003_Toggle_between_monthly_and_yearly_pricing_updates_the_pricing_view.py](./TC003_Toggle_between_monthly_and_yearly_pricing_updates_the_pricing_view.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/0e4d233a-aebb-4783-a1c4-ec1e0e1e9bd7
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Privacy Policy link navigates to the static Privacy Policy page
- **Test Code:** [TC004_Privacy_Policy_link_navigates_to_the_static_Privacy_Policy_page.py](./TC004_Privacy_Policy_link_navigates_to_the_static_Privacy_Policy_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/198ff225-0d83-4c46-bf72-a41f9fc48e45
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Terms of Service link navigates to the static Terms of Service page
- **Test Code:** [TC005_Terms_of_Service_link_navigates_to_the_static_Terms_of_Service_page.py](./TC005_Terms_of_Service_link_navigates_to_the_static_Terms_of_Service_page.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/d8496e81-4452-492c-84bc-4a301f3434e0
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 Successful sign-in returns user to /create and shows post type hub
- **Test Code:** [TC006_Successful_sign_in_returns_user_to_create_and_shows_post_type_hub.py](./TC006_Successful_sign_in_returns_user_to_create_and_shows_post_type_hub.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/992237fd-ee16-4339-8d7a-7a240a1e2591
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Invalid password shows Clerk authentication error
- **Test Code:** [TC007_Invalid_password_shows_Clerk_authentication_error.py](./TC007_Invalid_password_shows_Clerk_authentication_error.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Incorrect password error not displayed; sign-in modal shows "Couldn't find your account." instead.
- Error message does not mention 'password' or indicate an incorrect password.
- Submitted email 'fake.user@example.com' appears unregistered (Clerk reports account not found), preventing observation of the incorrect-password flow.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/62f00690-28ed-4a73-a24c-33172a45b9c8
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Authenticated user can access another protected route (/scheduled)
- **Test Code:** [TC008_Authenticated_user_can_access_another_protected_route_scheduled.py](./TC008_Authenticated_user_can_access_another_protected_route_scheduled.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/b5a97c19-b67d-4494-ab2a-d40810065a9b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Text post: Post Now to LinkedIn shows success toast
- **Test Code:** [TC011_Text_post_Post_Now_to_LinkedIn_shows_success_toast.py](./TC011_Text_post_Post_Now_to_LinkedIn_shows_success_toast.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- No LinkedIn account connected on the Connections page: 'Connect a LinkedIn account' button is present and no LinkedIn account entries are listed.
- Publish flow cannot proceed because no destination account is available/selected; the Publish control remained disabled when previously attempted.
- Create-and-post flow cannot be completed because a connected LinkedIn account is required to post but none are available to select.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/72d198ab-a4d6-4add-900e-3caf7d05e92b
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 Text post: Cannot submit without selecting an account
- **Test Code:** [TC013_Text_post_Cannot_submit_without_selecting_an_account.py](./TC013_Text_post_Cannot_submit_without_selecting_an_account.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/6baf94b8-a9a8-46fe-ab15-273f3d337d28
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015 Connections page shows connected accounts and plan limit counters
- **Test Code:** [TC015_Connections_page_shows_connected_accounts_and_plan_limit_counters.py](./TC015_Connections_page_shows_connected_accounts_and_plan_limit_counters.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/07466b20-aed3-463f-932b-6873ca6a1d9f
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC016 Instagram connection UI is not available (disabled or missing)
- **Test Code:** [TC016_Instagram_connection_UI_is_not_available_disabled_or_missing.py](./TC016_Instagram_connection_UI_is_not_available_disabled_or_missing.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/af3fa074-4f06-48d5-8c00-52c52822d260
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC017 View Scheduled page shows grouped batches with visible status and platform indicators
- **Test Code:** [TC017_View_Scheduled_page_shows_grouped_batches_with_visible_status_and_platform_indicators.py](./TC017_View_Scheduled_page_shows_grouped_batches_with_visible_status_and_platform_indicators.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/0687d8d6-5489-4880-b4b0-229ba18020bd
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC018 Reschedule a batch to a valid future date/time updates the scheduled date shown in list
- **Test Code:** [TC018_Reschedule_a_batch_to_a_valid_future_datetime_updates_the_scheduled_date_shown_in_list.py](./TC018_Reschedule_a_batch_to_a_valid_future_datetime_updates_the_scheduled_date_shown_in_list.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/b0285fdc-07b7-492d-b960-d6cc1ee5b91a
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC019 Cancel a scheduled batch changes its status to cancelled
- **Test Code:** [TC019_Cancel_a_scheduled_batch_changes_its_status_to_cancelled.py](./TC019_Cancel_a_scheduled_batch_changes_its_status_to_cancelled.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/2454e946-df26-4101-a398-122c0fc342af/7516ac68-ea4f-4b61-9042-13a0eacabd1c
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **86.67** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---