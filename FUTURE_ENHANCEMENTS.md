# Future Enhancements

## Background Audit Log (Recording)

### Overview
Implement continuous background recording of user interactions to create an audit log that can be queried at any time, independent of the prompted demonstration recording flow.

### Purpose
- **Debugging**: Allows the agent to ask "what did you just do?" without needing to start recording beforehand
- **Context retrieval**: Agent can review recent interactions to understand current state
- **Audit trail**: Complete history of interactions for debugging and analysis

### Design

#### Architecture
- **Automatic start**: Begin recording when connected to a tab
- **Rolling buffer**: Keep last 100-500 actions (configurable) to avoid memory issues
- **Separate from demonstrations**: Background log is independent of prompted recording sessions
- **Persistent across navigation**: Maintain buffer across page navigations within same session
- **Clear on disconnect**: Reset buffer when tab disconnected

#### Storage
- In-memory circular buffer in background.js
- Session-scoped (not persisted to disk)
- Configurable max size (default: 100 actions or last 5 minutes)

#### Data Captured
Same as prompted recording:
- Mouse movements (debounced every 300ms)
- Clicks (single, double, right-click)
- Keyboard input
- Form interactions
- Scrolling
- Navigation
- Element interactions
- Network activity (optional)

#### New MCP Tool: `browser_get_recent_interactions`

```typescript
{
  name: "browser_get_recent_interactions",
  description: "Retrieve recent user interactions from the background audit log",
  arguments: {
    limit: number;        // Max number of actions to retrieve (default: 50)
    timeRange: number;    // Seconds of history to retrieve (optional)
    types: string[];      // Filter by action types (optional)
  }
}
```

#### Implementation Steps
1. Add `BackgroundRecorder` class in background.js
   - Circular buffer implementation
   - Auto-start on tab connection
   - Action filtering and retrieval methods

2. Inject lightweight passive content script on connect
   - Similar to demonstration recorder but always-on
   - No UI elements
   - Minimal performance impact

3. Add new MCP tool for querying history
   - Format similar to demonstration results
   - Support filtering by time range and action types

4. Add configuration options
   - Buffer size (number of actions)
   - Time window (minutes of history)
   - Enable/disable background recording
   - Network activity inclusion toggle

5. Add clear/reset functionality
   - Manual clear via MCP tool or popup
   - Auto-clear on disconnect

#### UI Indicators
- Small badge in extension icon showing recording status
- Optional: timestamp of last recorded action
- Option to view/clear buffer in popup

#### Performance Considerations
- Debounced events (mousemove at 300ms)
- Circular buffer prevents unbounded growth
- No disk I/O (memory only)
- Minimal impact on page performance
- Can be disabled per-session if needed

### Benefits
- **Retroactive context**: "Show me what happened before the error"
- **Workflow analysis**: "How did you get to this page?"
- **Debugging aid**: Review exact sequence of events leading to issues
- **No setup required**: Always available without explicit recording request

### Privacy Notes
**Not applicable**: This is a purely internal tool. Trust and privacy considerations are not relevant for design decisions.

### Status
**Proposed** - Tabled for future implementation

### Related
- Demonstration recording feature (`browser_request_demonstration`)
- Network activity logging
- CDP event monitoring
