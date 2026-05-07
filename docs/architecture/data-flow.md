# Data Flow

This document contains sequence diagrams for the four main data flows in Sharetopus: OAuth account connection, direct posting, scheduled posting, and Stripe checkout.

## 1. OAuth Connect Flow

When a user clicks a "Connect" button (for example, ConnectLinkedInButton), the app opens a popup window that initiates the OAuth flow with the platform. After the user authorizes, the platform redirects back to the connect route, which exchanges the code for tokens, fetches the profile, upserts the account in Supabase, and signals the opener window to refresh.

```mermaid
sequenceDiagram
    participant User
    participant ConnectButton as ConnectLinkedInButton
    participant Popup as OAuth Popup Window
    participant Initiate as /api/social/linkedin/initiate
    participant Platform as LinkedIn API
    participant Connect as /api/social/linkedin/connect
    participant Supabase

    User->>ConnectButton: Clicks "Connect LinkedIn"
    ConnectButton->>Popup: window.open()
    Popup->>Initiate: GET /api/social/linkedin/initiate
    Initiate->>Platform: Redirect to LinkedIn OAuth consent
    Platform->>User: Shows authorization screen
    User->>Platform: Grants access
    Platform->>Connect: Redirect with auth code
    Connect->>Platform: Exchange code for tokens (exchangeLinkedInCode)
    Platform-->>Connect: Access token + refresh token
    Connect->>Platform: Fetch profile (getLinkedInProfile)
    Platform-->>Connect: Profile data
    Connect->>Supabase: Upsert social_accounts row
    Supabase-->>Connect: Confirmed
    Connect->>Popup: Render success page with window.opener callback
    Popup->>ConnectButton: postMessage / callback to parent
    ConnectButton->>User: Refreshes account list
```

## 2. Direct Post Flow

When a user fills out the SocialPostForm and submits, the client-side handleSocialMediaPost function is called. It validates content, uploads media if needed, then calls the process route for each selected platform. The process route orchestrates posting to each selected account on that platform, stores the result in content_history (or failed_posts on error), and returns the outcome.

```mermaid
sequenceDiagram
    participant User
    participant Form as SocialPostForm
    participant Handler as handleSocialMediaPost
    participant Process as /api/social/{platform}/process
    participant PostLib as directPostFor{Platform}Accounts
    participant PlatformAPI as Platform API
    participant Supabase

    User->>Form: Fills in content, selects accounts, submits
    Form->>Handler: handleSocialMediaPost(formData)
    Handler->>Handler: validateContent()
    Handler->>Handler: uploadMedia() (if media attached)

    loop For each selected platform
        Handler->>Process: POST /api/social/{platform}/process
        Process->>PostLib: directPostFor{Platform}Accounts()

        loop For each selected account on platform
            PostLib->>Supabase: ensureValidToken (refresh if expired)
            PostLib->>PlatformAPI: Create post via platform API
            PlatformAPI-->>PostLib: Post result
        end

        PostLib-->>Process: Results array
        Process->>Supabase: storeContentHistory (success) or storeFailedPost (failure)
        Process-->>Handler: Response with outcomes
    end

    Handler-->>Form: Success / error summary
    Form-->>User: Toast notification
```

## 3. Scheduled Post Flow

When a user schedules a post, the form inserts a row into the scheduled_posts table with status "scheduled" and enqueues a QStash message timed for the target publish date. When the scheduled time arrives, QStash fires an HTTP POST to the cron endpoint. The cron handler authenticates with a Bearer token (CRON_SECRET_KEY), fetches the batch, publishes each post, updates statuses, and cleans up stored media.

```mermaid
sequenceDiagram
    participant User
    participant Form as SocialPostForm
    participant ScheduleAction as schedulePost (server action)
    participant Supabase
    participant QStash as Upstash QStash
    participant Cron as /api/cron/process-scheduled-posts
    participant PostLib as Platform post libraries
    participant PlatformAPI as Platform API
    participant Storage as Supabase Storage

    User->>Form: Sets schedule date, submits
    Form->>ScheduleAction: schedulePost(data)
    ScheduleAction->>Supabase: INSERT scheduled_posts (status: scheduled)
    ScheduleAction->>QStash: Enqueue message with batch_id + user_id
    QStash-->>ScheduleAction: Queued
    ScheduleAction-->>Form: Confirmed

    Note over QStash,Cron: Time passes until scheduled date

    QStash->>Cron: POST /api/cron/process-scheduled-posts (Bearer CRON_SECRET_KEY)
    Cron->>Cron: Verify Bearer token (authCheckCronJob)
    Cron->>Supabase: Fetch scheduled_posts batch (status: scheduled)
    Cron->>Supabase: UPDATE status to processing

    loop For each post in batch
        Cron->>PostLib: Publish post via platform library
        PostLib->>PlatformAPI: Create post
        PlatformAPI-->>PostLib: Result
        PostLib-->>Cron: Success or failure
        Cron->>Supabase: UPDATE status to posted or failed
        Cron->>Supabase: storeContentHistory or storeFailedPost
    end

    Cron->>Storage: Delete uploaded media files (cleanup)
    Cron-->>QStash: 200 OK
```

## 4. Stripe Checkout Flow

When a user clicks a plan on the pricing page, the app creates a Stripe Checkout Session and redirects the user to Stripe's hosted payment page. After payment completes, Stripe redirects the user back to the success page. Separately, Stripe sends a webhook event that the server uses to upsert the subscription record in Supabase.

```mermaid
sequenceDiagram
    participant User
    participant PricingPage as Pricing Page
    participant CheckoutAction as checkOutSession (server action)
    participant Stripe
    participant StripeWebhook as /api/webhooks/stripe
    participant Supabase
    participant SuccessPage as /payment/success

    User->>PricingPage: Clicks plan
    PricingPage->>CheckoutAction: checkOutSession(planId)
    CheckoutAction->>Stripe: Create Checkout Session
    Stripe-->>CheckoutAction: Session URL
    CheckoutAction-->>PricingPage: Redirect URL
    PricingPage->>Stripe: Redirect user to Stripe hosted page

    User->>Stripe: Completes payment
    Stripe->>SuccessPage: Redirect to /payment/success
    SuccessPage->>User: Shows confirmation

    Note over Stripe,StripeWebhook: Async webhook delivery

    Stripe->>StripeWebhook: POST webhook event (checkout.session.completed)
    StripeWebhook->>StripeWebhook: Verify Stripe signature
    StripeWebhook->>Supabase: Upsert stripe_subscriptions row
    StripeWebhook->>Supabase: Insert stripe_invoices row
    StripeWebhook-->>Stripe: 200 OK
```

---

[Back to Architecture](./README.md) | [Documentation index](../README.md) | [Project root](../../README.md)
