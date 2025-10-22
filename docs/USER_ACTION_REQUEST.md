# User Action Request Feature

## Overview

The `browser_request_user_action` tool allows an AI agent to request the user to perform actions in the browser. This is useful for two primary use cases:

1. **Learning workflows**: Agent observes user interactions to learn how to perform tasks
2. **User assistance**: Agent gets user to navigate to a specific state or perform actions the agent cannot do

## How It Works

### Flow

1. **Agent calls tool** → `browser_request_user_action(request: "Please navigate to settings", timeout: 120)`
2. **UI appears**:
   - Draggable overlay in upper left with instructions
   - Persistent Chrome notification above the tab
   - Badge on extension icon
3. **User performs actions** → All interactions captured by background interaction log
4. **User clicks Complete/Reject** → Tool returns result with:
   - Status: `completed`, `rejected`, or `timeout`
   - Interactions: All user actions from request start to completion
   - Timestamps: Start time, end time, duration
5. **Agent processes result** → Can analyze interaction sequence to learn patterns

### Key Features

#### Draggable Overlay
- Click and drag the header area to reposition
- Starts in upper left corner
- Stays on top of all page content (z-index: 2147483647)
- Clean, modern design with rounded corners

#### Persistent Notification
- Chrome notification appears above the tab
- Shows first 100 characters of request
- Stays visible until user responds (`requireInteraction: true`)
- Auto-clears on Complete/Reject

#### Navigation Persistence
- Overlay automatically re-appears after page navigation
- Request stays active across multiple pages
- Allows multi-page workflows (e.g., "Add item to cart and checkout")

#### Background Interaction Log
- No custom recording code needed
- Uses existing background interaction capture system
- All interactions timestamped and categorized
- Query by time range: start timestamp → end timestamp

## Tool Schema

```typescript
{
  name: "browser_request_user_action",
  arguments: {
    request: string,      // Clear instructions for user
    timeout?: number      // Max wait time in seconds (default: 300s)
  }
}
```

## Return Format

```typescript
{
  status: 'completed' | 'rejected' | 'timeout',
  request: string,
  startTime: number,
  endTime: number,
  duration: number,
  interactions: Interaction[]
}
```

### Interaction Object

```typescript
{
  timestamp: number,
  type: 'click' | 'keyboard' | 'scroll' | 'navigation' | 'visibility' | ...,
  selector?: string,
  element?: {
    tagName: string,
    text?: string,
    attributes?: object
  },
  url?: string,
  key?: string,
  value?: string
}
```

## Example Usage

### Simple Task
```javascript
const result = await browser_request_user_action({
  request: "Please click the Sign In button",
  timeout: 60
});

// Result contains:
// - status: 'completed'
// - interactions: [{ type: 'click', selector: '.sign-in-btn', ... }]
```

### Complex Multi-Step Task
```javascript
const result = await browser_request_user_action({
  request: `Please perform these steps:
1. Scroll down to the pricing section
2. Click on the "Enterprise" plan
3. Fill in the contact form
4. Click Submit

Click Complete when done.`,
  timeout: 180
});

// Result contains all interactions:
// - scroll events
// - click on pricing plan
// - keyboard input in form fields
// - click on submit button
```

### Learning Workflow
```javascript
const result = await browser_request_user_action({
  request: "Please show me how to add an item to the cart and proceed to checkout",
  timeout: 240
});

// Agent can analyze result.interactions to learn:
// - Which elements were clicked
// - What text was typed
// - Navigation flow
// - Timing between actions
```

## Comparison with Request Demonstration

| Feature | `request_demonstration` | `request_user_action` |
|---------|------------------------|---------------------|
| **Recording** | Custom session | Background log |
| **Content Script** | Required | Not needed |
| **UI Complexity** | 250+ lines | 165 lines |
| **Start Flow** | User clicks Start | Immediate overlay |
| **Navigation** | Breaks recording | Persists automatically |
| **Draggable** | No | Yes |
| **Notification** | No | Yes (persistent) |
| **Use Cases** | Learning only | Learning + Assistance |
| **Code Maintenance** | High | Low |

## Technical Implementation

### Background Handler (`extension/background.js`)
- `handleRequestUserAction()`: Main handler
- `injectUserActionOverlay()`: Creates draggable UI
- Listens for `USER_ACTION_COMPLETE` and `USER_ACTION_REJECTED` messages
- Queries `backgroundRecorder.get()` for time-filtered interactions
- Manages Chrome notification lifecycle
- Sets up navigation listener for page changes

### Tool Registration (`src/tools/user-action.ts`)
- MCP tool definition
- Result formatting
- Interaction grouping by type
- Summary generation

### Message Types (`src/types/messaging.ts`)
```typescript
browser_request_user_action: { request: string }
```

### Permissions Required (`extension/manifest.json`)
- `notifications`: Chrome notifications
- `webNavigation`: Detect page navigation
- `scripting`: Inject overlay
- `tabs`: Tab management

## Best Practices

### Writing Effective Requests

✅ **Good**
```javascript
"Please navigate to the settings page and enable dark mode.
Take your time and click Complete when done."
```

❌ **Bad**
```javascript
"Do settings stuff"
```

### Request Guidelines
1. **Be specific**: Clear step-by-step instructions
2. **Set context**: Explain what you're trying to achieve
3. **Realistic timeout**: Allow enough time for user to complete
4. **Remind about Complete**: Tell user to click Complete when done

### Timeout Recommendations
- Simple click: 30-60s
- Form fill: 60-120s
- Multi-page workflow: 180-300s
- Complex task: 300-600s

## Troubleshooting

### Overlay doesn't appear
- Check extension is connected
- Verify `scripting` permission in manifest
- Check console for injection errors

### Notification doesn't show
- Check `notifications` permission
- Verify Chrome notifications enabled in OS
- Some sites may block notifications

### Overlay disappears on navigation
- Check `webNavigation` permission
- Verify navigation listener is registered
- Check browser console for errors

### Timeout before user completes
- Increase timeout parameter
- Check if WebSocket connection is stable
- Verify background log is capturing events

## Future Enhancements

Potential improvements (not yet implemented):
- [ ] Progress indicator (action count)
- [ ] Minimize/expand overlay
- [ ] Multiple concurrent requests
- [ ] Request history/replay
- [ ] Voice instructions (text-to-speech)
- [ ] Screenshot on Complete
- [ ] Undo/redo captured actions
- [ ] Export interactions as script
