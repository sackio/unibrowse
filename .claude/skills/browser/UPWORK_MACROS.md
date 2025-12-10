# 🤨 Upwork Macros Reference

Complete reference for all 14 Upwork-specific macros used for applicant management and messaging workflows.

## Table of Contents

1. [Overview](#overview)
2. [Extraction Macros (6)](#extraction-macros)
3. [Messaging Macros (3)](#messaging-macros)
4. [Interaction Macros (3)](#interaction-macros)
5. [Utility Macros (2)](#utility-macros)
6. [Complete Workflows](#complete-workflows)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Overview

**Upwork macros** are specialized JavaScript functions stored in MongoDB that automate Upwork-specific operations. They handle applicant extraction, data export, message thread management, and proposal analysis on the Upwork platform.

**Total Upwork Macros**: 14
- **Extraction**: 6 macros
- **Messaging**: 3 macros
- **Interaction**: 3 macros
- **Utility**: 2 macros

**Site**: `upwork.com`

**Usage Pattern**:
```javascript
// 1. List available macros
const macros = await mcp__browser__browser_list_macros({ site: "upwork.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "extract_job_applicants",
  params: { maxSkills: 10 },
  tabTarget: tabId
});

// 3. Use results
console.log("Applicants:", result.content.applicants);
```

---

## Extraction Macros

### `extract_job_applicants`

**Description**: Extract all applicants from an Upwork job posting applicants page with comprehensive details

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `includeFullCoverLetter` (boolean, optional): Include full cover letter text instead of preview (default: false)
- `maxSkills` (number, optional): Maximum number of skills to extract per applicant (default: 10)

**Returns**:
```javascript
{
  "totalApplicants": 42,
  "jobTitle": "3D Asset Development - Photogrammetry & GIS",
  "applicants": [
    {
      "index": 1,
      "name": "John Developer",
      "location": "Pakistan",
      "title": "Photogrammetry Specialist",
      "rate": "$45/hr",
      "jobSuccess": "96%",
      "completedJobs": 23,
      "totalHours": 1240,
      "skills": ["Photogrammetry", "3D Modeling", "LiDAR", "GIS"],
      "coverLetterPreview": "I have extensive experience with photogrammetry...",
      "isBoosted": false,
      "contractorUid": "xyz123",
      "applicationId": "abc456"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_job_applicants",
  params: {
    includeFullCoverLetter: true,
    maxSkills: 15
  },
  tabTarget: tabId
});

console.log(`Job: ${result.content.jobTitle}`);
console.log(`Total applicants: ${result.content.totalApplicants}`);
```

**Use Cases**:
- Screen applicants for job postings
- Analyze applicant skills and experience
- Compare applicant rates and success rates
- Build applicant shortlists

**Notes**:
- Works on Upwork job posting applicants page (ProposalRow elements)
- Extracts data from list view without opening modals
- Includes boosted application status
- Provides both quick preview and full cover letter options

---

### `export_applicants_csv`

**Description**: Export Upwork applicants data to CSV format for spreadsheet analysis

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `includeSkills` (boolean, optional): Include skills column in CSV (default: true)
- `includeCoverLetter` (boolean, optional): Include cover letter preview column (default: false)

**Returns**:
```javascript
{
  "csv": "Name,Rate ($/hr),Job Success (%),Completed Jobs,Total Hours,Boosted,Skills\nJohn Developer,$45,96,23,1240,No,Photogrammetry; 3D Modeling; LiDAR; GIS\n...",
  "rowCount": 42,
  "timestamp": "2025-12-10T15:30:00.000Z"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "export_applicants_csv",
  params: {
    includeSkills: true,
    includeCoverLetter: false
  },
  tabTarget: tabId
});

// Copy CSV to clipboard or save to file
const csvContent = result.content.csv;
console.log(csvContent);
```

**Use Cases**:
- Export applicants to spreadsheet for analysis
- Build applicant comparison documents
- Share applicant data with team members
- Create applicant tracking spreadsheets

**Notes**:
- Properly quotes CSV fields containing commas
- Includes all metrics from list view
- CSV headers included for easy import to Excel/Google Sheets
- Timestamp shows when export was generated

---

### `extract_applicant_detail`

**Description**: Extract complete applicant details from the Upwork applicant detail modal/slider

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `includeWorkHistory` (boolean, optional): Include work history section (default: true)
- `includePortfolio` (boolean, optional): Include portfolio items (default: true)

**Returns**:
```javascript
{
  "personalInfo": {
    "name": "John Developer",
    "location": "Pakistan",
    "localTime": "11:30 pm local time",
    "profileUrl": "https://www.upwork.com/freelancers/~xyz123",
    "isVerified": true,
    "badges": {
      "risingTalent": false,
      "topRated": true,
      "topRatedPlus": false
    }
  },
  "proposal": {
    "rate": "$45/hr",
    "isBoosted": false,
    "coverLetter": "I have extensive experience with photogrammetry and 3D asset development..."
  },
  "screeningQuestions": [
    {
      "question": "Do you have experience with LiDAR data?",
      "answer": "Yes, I've processed point clouds from multiple sources"
    }
  ],
  "stats": {
    "jobSuccess": "96%",
    "completedJobs": 23,
    "totalHours": 1240,
    "totalEarned": "$56,000+ total earned"
  },
  "skills": ["Photogrammetry", "3D Modeling", "LiDAR", "GIS", "CloudCompare"],
  "workHistory": ["Work history available in modal"]
}
```

**Example**:
```javascript
// First click to open applicant modal
await mcp__browser__browser_click({
  element: "Applicant row",
  ref: "applicant_row_123"
});

// Then extract full details
const result = await mcp__browser__browser_execute_macro({
  id: "extract_applicant_detail",
  params: {
    includeWorkHistory: true,
    includePortfolio: true
  },
  tabTarget: tabId
});

console.log("Full cover letter:", result.content.proposal.coverLetter);
console.log("Screening answers:", result.content.screeningQuestions);
```

**Use Cases**:
- Deep dive into applicant qualifications
- Review screening question responses
- Verify profile badges and verification status
- Analyze full cover letters
- Check complete work history and portfolio

**Notes**:
- Requires applicant detail modal to be open
- Extracts profile verification badges
- Parses screening questions and responses
- Includes full earnings history
- Work history available but requires enhanced parsing

---

### `extract_all_applicants_with_details`

**Description**: Extract all applicants from list view with maximum available details without opening modals

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `maxApplicants` (number, optional): Maximum number of applicants to extract (default: 50)
- `includeFullSkills` (boolean, optional): Include full skills list per applicant (default: true)

**Returns**:
```javascript
{
  "jobTitle": "3D Asset Development - Photogrammetry & GIS",
  "totalApplicants": 42,
  "extractedAt": "2025-12-10T15:30:00.000Z",
  "applicants": [
    {
      "index": 1,
      "applicationId": "app_123",
      "contractorUid": "uid_456",
      "name": "John Developer",
      "location": "Pakistan",
      "title": "Photogrammetry Specialist",
      "rate": "$45/hr",
      "jobSuccess": "96%",
      "completedJobs": 23,
      "totalHours": 1240,
      "skills": ["Photogrammetry", "3D Modeling", "LiDAR"],
      "coverLetterPreview": "I have extensive experience...",
      "isBoosted": false,
      "badges": {
        "topRatedPlus": false,
        "topRated": true,
        "risingTalent": false
      },
      "profileUrl": "https://www.upwork.com/freelancers/~xyz123"
    }
  ],
  "note": "This macro extracts data from list view only. For full cover letters and screening questions, use extract_applicant_detail macro on each opened modal."
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  params: {
    maxApplicants: 100,
    includeFullSkills: true
  },
  tabTarget: tabId
});

// Filter high-rated applicants
const topApplicants = result.content.applicants.filter(a =>
  a.badges.topRated || a.badges.topRatedPlus
);

console.log(`Top rated: ${topApplicants.length} applicants`);
```

**Use Cases**:
- Quick comprehensive screening without opening each modal
- Filter applicants by badges and success rate
- Analyze rate distribution across applicants
- Build applicant comparison lists
- Quick portfolio review using profile URLs

**Notes**:
- Doesn't require opening individual applicant modals
- Includes profile verification badges
- Extracts profile URLs for quick link access
- Efficient for bulk applicant review
- Full cover letters and screening questions require modal access

---

### `list_message_threads`

**Description**: List all message threads/conversations in the Upwork messages sidebar

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `maxThreads` (number, optional): Maximum threads to return (default: 20)

**Returns**:
```javascript
{
  "success": true,
  "totalThreads": 15,
  "threads": [
    {
      "index": 0,
      "name": "John Developer",
      "preview": "Thanks for the opportunity! I'm excited to start working on...",
      "hasUnread": true,
      "isActive": true
    },
    {
      "index": 1,
      "name": "Sarah Designer",
      "preview": "I completed the first milestone. Can you review?",
      "hasUnread": false,
      "isActive": false
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "list_message_threads",
  params: { maxThreads: 50 },
  tabTarget: tabId
});

// Find unread messages
const unread = result.content.threads.filter(t => t.hasUnread);
console.log(`Unread messages: ${unread.length}`);
```

**Use Cases**:
- Quick overview of message threads
- Identify unread messages
- Find active conversations
- Organize message review workflow

**Notes**:
- Works on Upwork messages page
- Shows preview of last message
- Indicates unread status
- Useful for message inbox management

---

### `read_message_thread`

**Description**: Read all messages in the currently open thread/conversation

**Site**: `upwork.com`

**Category**: extraction

**Parameters**:
- `maxMessages` (number, optional): Maximum messages to return (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "threadTitle": "3D Asset Development Project",
  "threadSubtitle": "with John Developer",
  "messageCount": 12,
  "messages": [
    {
      "index": 0,
      "sender": "John Developer",
      "time": "Nov 21, 2025 at 2:30 PM",
      "message": "Thanks for the opportunity! I'm excited to work on this project.",
      "isSystem": false
    },
    {
      "index": 1,
      "sender": "System",
      "time": "Nov 22, 2025",
      "message": "Contract was created and sent to John Developer",
      "isSystem": true
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "read_message_thread",
  params: { maxMessages: 100 },
  tabTarget: tabId
});

console.log(`Thread: ${result.content.threadTitle}`);
result.content.messages.forEach(msg => {
  if (!msg.isSystem) {
    console.log(`${msg.sender}: ${msg.message}`);
  }
});
```

**Use Cases**:
- Extract message conversation history
- Archive important conversations
- Monitor project communication
- Build message transcripts
- Track milestone discussions

**Notes**:
- Requires thread to be open in message panel
- Distinguishes system messages from user messages
- Preserves chronological order
- Includes timestamps for all messages

---

## Messaging Macros

### `send_message_to_applicant`

**Description**: Send a message to an applicant or contractor on Upwork

**Site**: `upwork.com`

**Category**: interaction

**Parameters**:
- `recipientName` (string, required): Name of applicant/contractor to message
- `subject` (string, optional): Subject line for new conversation
- `message` (string, required): Message body text

**Returns**:
```javascript
{
  "success": true,
  "action": "send_message",
  "recipient": "John Developer",
  "subject": "Follow-up on 3D Asset Project",
  "messageLength": 245,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "message": "Thank you for your proposal. I'd like to discuss the project timeline..."
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "send_message_to_applicant",
  params: {
    recipientName: "John Developer",
    subject: "Questions about your proposal",
    message: "Hi John, I reviewed your proposal and have a few questions about your experience with LiDAR processing. Could you clarify..."
  },
  tabTarget: tabId
});

console.log("Message sent to:", result.content.recipient);
```

**Use Cases**:
- Quick communication with applicants
- Ask clarifying questions about proposals
- Provide job details and requirements
- Negotiate rates and timelines
- Send invitations to apply

**Notes**:
- Requires Upwork messaging interface
- Subject line useful for new conversations
- Plain text message support
- Timestamps track when message was sent

---

### `reject_applicant`

**Description**: Reject an applicant with optional message on Upwork

**Site**: `upwork.com`

**Category**: interaction

**Parameters**:
- `applicantName` (string, required): Name of applicant to reject
- `reason` (string, optional): Reason for rejection (custom message)

**Returns**:
```javascript
{
  "success": true,
  "action": "reject_applicant",
  "applicantName": "Jane Designer",
  "rejectionReason": "Found candidate with more specific experience",
  "timestamp": "2025-12-10T15:30:00.000Z",
  "message": "Applicant has been rejected"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "reject_applicant",
  params: {
    applicantName: "Jane Designer",
    reason: "We found a candidate with more specific experience in LiDAR processing"
  },
  tabTarget: tabId
});

console.log("Rejected:", result.content.applicantName);
```

**Use Cases**:
- Screen out unsuitable applicants
- Provide feedback to applicants
- Free up job slot for other applicants
- Maintain professional communication
- Keep applicant database clean

**Notes**:
- Optional custom rejection message
- Updates job applicant status
- Marks applicant as rejected in system
- Useful for hiring workflow management

---

### `shortlist_applicant`

**Description**: Shortlist an applicant for further consideration

**Site**: `upwork.com`

**Category**: interaction

**Parameters**:
- `applicantName` (string, required): Name of applicant to shortlist
- `notes` (string, optional): Internal notes about applicant

**Returns**:
```javascript
{
  "success": true,
  "action": "shortlist_applicant",
  "applicantName": "John Developer",
  "notes": "Strong LiDAR experience, top-rated, available immediately",
  "timestamp": "2025-12-10T15:30:00.000Z",
  "message": "Applicant shortlisted"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "shortlist_applicant",
  params: {
    applicantName: "John Developer",
    notes: "Excellent portfolio, matches all requirements, quick response time"
  },
  tabTarget: tabId
});

console.log("Shortlisted:", result.content.applicantName);
```

**Use Cases**:
- Mark promising applicants for later review
- Organize hiring workflow
- Create candidate comparison lists
- Track top candidates
- Manage applicant pipeline

**Notes**:
- Internal notes stay in Upwork system
- Helps organize hiring process
- Easy to compare shortlisted applicants
- Can be toggled on/off

---

## Interaction Macros

### `hire_applicant`

**Description**: Hire/invite an applicant to a job or contract

**Site**: `upwork.com`

**Category**: interaction

**Parameters**:
- `applicantName` (string, required): Name of applicant to hire
- `rate` (string, optional): Hourly rate in format "$XX/hr" (default: use applicant's proposed rate)
- `contractTerms` (string, optional): Contract type - "hourly" or "fixed" (default: "hourly")

**Returns**:
```javascript
{
  "success": true,
  "action": "hire_applicant",
  "applicantName": "John Developer",
  "rate": "$45/hr",
  "contractType": "hourly",
  "timestamp": "2025-12-10T15:30:00.000Z",
  "message": "Job invitation sent to John Developer"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "hire_applicant",
  params: {
    applicantName: "John Developer",
    rate: "$45/hr",
    contractTerms: "hourly"
  },
  tabTarget: tabId
});

console.log("Hired:", result.content.applicantName);
```

**Use Cases**:
- Extend job offer to selected applicant
- Create contract agreement
- Set rates and contract terms
- Finalize hiring decision
- Begin work engagement

**Notes**:
- Can override applicant's proposed rate
- Hourly or fixed-price contracts
- Sends formal invitation to applicant
- Creates binding contract agreement

---

### `view_applicant_portfolio`

**Description**: Navigate to an applicant's portfolio page

**Site**: `upwork.com`

**Category**: navigation

**Parameters**:
- `applicantName` (string, required): Name of applicant whose portfolio to view
- `openNewTab` (boolean, optional): Open portfolio in new tab (default: false)

**Returns**:
```javascript
{
  "success": true,
  "action": "view_portfolio",
  "applicantName": "John Developer",
  "portfolioUrl": "https://www.upwork.com/freelancers/~xyz123",
  "message": "Navigating to John Developer's portfolio"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "view_applicant_portfolio",
  params: {
    applicantName: "John Developer",
    openNewTab: true
  },
  tabTarget: tabId
});

console.log("Portfolio URL:", result.content.portfolioUrl);
```

**Use Cases**:
- Review applicant's previous work
- Verify skills with portfolio samples
- Assess quality of previous projects
- Check portfolio links and references
- Make hiring decisions based on work samples

**Notes**:
- Opens full portfolio page
- Shows all previous projects and samples
- Displays client reviews and ratings
- Option to open in new tab for easy comparison

---

### `compare_applicants`

**Description**: Create a side-by-side comparison of multiple applicants

**Site**: `upwork.com`

**Category**: utility

**Parameters**:
- `applicants` (array, required): Array of applicant names to compare (min: 2, max: 5)
- `compareBy` (array, optional): Metrics to compare - any of: "rate", "experience", "rating", "skills", "badges" (default: all)

**Returns**:
```javascript
{
  "success": true,
  "action": "compare_applicants",
  "applicantsCompared": ["John Developer", "Jane Designer"],
  "comparisonMetrics": ["rate", "experience", "rating", "skills", "badges"],
  "comparison": {
    "John Developer": {
      "rate": "$45/hr",
      "experience": "23 completed jobs, 1240 hours",
      "rating": "96% job success",
      "skills": ["Photogrammetry", "3D Modeling", "LiDAR"],
      "badges": ["Top Rated"]
    },
    "Jane Designer": {
      "rate": "$50/hr",
      "experience": "18 completed jobs, 950 hours",
      "rating": "94% job success",
      "skills": ["UI/UX Design", "Figma", "Prototyping"],
      "badges": ["Rising Talent"]
    }
  },
  "recommendation": "John Developer offers better value for LiDAR-focused project"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "compare_applicants",
  params: {
    applicants: ["John Developer", "Jane Designer", "Bob Engineer"],
    compareBy: ["rate", "rating", "skills"]
  },
  tabTarget: tabId
});

console.log("Comparison:", result.content.comparison);
```

**Use Cases**:
- Compare multiple candidates side-by-side
- Make hiring decisions based on metrics
- Evaluate rate vs. experience trade-offs
- Compare skill sets
- Benchmark applicants

**Notes**:
- Supports up to 5 applicants in comparison
- Flexible comparison metrics
- Includes recommendations based on criteria
- Easy visual comparison format

---

## Complete Workflows

### Workflow 1: Full Applicant Screening

```javascript
// Step 1: Extract all applicants from list view
const applicantList = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  params: { maxApplicants: 50 },
  tabTarget: tabId
});

// Step 2: Filter top candidates
const topCandidates = applicantList.content.applicants.filter(a =>
  (a.badges.topRated || a.badges.topRatedPlus) &&
  a.jobSuccess > "90%"
);

// Step 3: For each top candidate, extract full details
const detailedApplicants = [];
for (const candidate of topCandidates.slice(0, 5)) {
  // Click to open modal
  await mcp__browser__browser_click({
    element: `Applicant: ${candidate.name}`,
    ref: `app_${candidate.index}`
  });

  // Extract full details
  const details = await mcp__browser__browser_execute_macro({
    id: "extract_applicant_detail",
    params: { includeWorkHistory: true },
    tabTarget: tabId
  });

  detailedApplicants.push({
    basic: candidate,
    detailed: details.content
  });
}

// Step 4: Export top 3 to CSV for final review
const topThree = detailedApplicants.slice(0, 3);
console.log("Top candidates:", topThree);
```

### Workflow 2: Batch Hire with Comparison

```javascript
// Step 1: Get applicants
const applicants = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  params: { maxApplicants: 20 },
  tabTarget: tabId
});

// Step 2: Compare top 3
const topThree = applicants.content.applicants.slice(0, 3);
const comparison = await mcp__browser__browser_execute_macro({
  id: "compare_applicants",
  params: {
    applicants: topThree.map(a => a.name),
    compareBy: ["rate", "rating", "experience"]
  },
  tabTarget: tabId
});

// Step 3: Hire the selected applicant
const selectedApplicant = topThree[0];
const hired = await mcp__browser__browser_execute_macro({
  id: "hire_applicant",
  params: {
    applicantName: selectedApplicant.name,
    rate: selectedApplicant.rate,
    contractTerms: "hourly"
  },
  tabTarget: tabId
});

// Step 4: Send welcome message
await mcp__browser__browser_execute_macro({
  id: "send_message_to_applicant",
  params: {
    recipientName: selectedApplicant.name,
    subject: "Welcome to the Project!",
    message: "Welcome to the team! I'm excited to work with you. Here are the project details..."
  },
  tabTarget: tabId
});

console.log("Hired and notified:", selectedApplicant.name);
```

### Workflow 3: Manage Messages and Conversations

```javascript
// Step 1: List all message threads
const threads = await mcp__browser__browser_execute_macro({
  id: "list_message_threads",
  params: { maxThreads: 50 },
  tabTarget: tabId
});

// Step 2: Find unread messages
const unread = threads.content.threads.filter(t => t.hasUnread);
console.log(`Found ${unread.length} unread messages`);

// Step 3: Read each unread thread
for (const thread of unread.slice(0, 5)) {
  // Click thread to open it
  await mcp__browser__browser_click({
    element: `Thread: ${thread.name}`,
    ref: `thread_${thread.index}`
  });

  // Read messages
  const messages = await mcp__browser__browser_execute_macro({
    id: "read_message_thread",
    params: { maxMessages: 50 },
    tabTarget: tabId
  });

  console.log(`${messages.content.threadTitle}: ${messages.content.messageCount} messages`);

  // Send response if needed
  if (messages.content.messages.length > 0) {
    const lastMessage = messages.content.messages[messages.content.messageCount - 1];

    await mcp__browser__browser_execute_macro({
      id: "send_message_to_applicant",
      params: {
        recipientName: lastMessage.sender,
        message: "Thank you for your message! I'll review and get back to you shortly."
      },
      tabTarget: tabId
    });
  }
}
```

---

## Best Practices

### 1. Always Extract Applicants First

Extract the full applicant list before making hiring decisions:

```javascript
// ✅ Good: Get all data first
const applicants = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  params: { maxApplicants: 50 }
});

const topCandidates = applicants.content.applicants.filter(a => a.jobSuccess > "90%");

// ❌ Bad: Making decisions without full data
await mcp__browser__browser_execute_macro({
  id: "hire_applicant",
  params: { applicantName: "John" }
});
```

### 2. Compare Before Hiring

Always compare multiple candidates before making final hiring decision:

```javascript
// ✅ Good: Compare candidates
const candidates = ["John", "Jane", "Bob"];
const comparison = await mcp__browser__browser_execute_macro({
  id: "compare_applicants",
  params: { applicants: candidates }
});

// Then hire the best fit
const best = comparison.content.recommendation;

// ❌ Bad: Hire first applicant without comparison
await mcp__browser__browser_execute_macro({
  id: "hire_applicant",
  params: { applicantName: "John" }
});
```

### 3. Review Full Details for Top Candidates

For final candidates, review their complete details including cover letters:

```javascript
// ✅ Good: Review full details
const details = await mcp__browser__browser_execute_macro({
  id: "extract_applicant_detail",
  params: { includeWorkHistory: true }
});

console.log("Cover letter:", details.content.proposal.coverLetter);
console.log("Screening answers:", details.content.screeningQuestions);

// ❌ Bad: Only reviewing list view data
const listData = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details"
});

console.log("Cover letter:", listData.content.applicants[0].coverLetterPreview);
```

### 4. Use CSV for Team Collaboration

Export applicants to CSV for sharing with team:

```javascript
// ✅ Good: Export for team review
const csv = await mcp__browser__browser_execute_macro({
  id: "export_applicants_csv",
  params: {
    includeSkills: true,
    includeCoverLetter: true
  }
});

// Share CSV with team for feedback
console.log(csv.content.csv);

// ❌ Bad: Trying to share raw data
const raw = await mcp__browser__browser_execute_macro({
  id: "extract_job_applicants"
});

// Hard to format for sharing
```

### 5. Organize Messages Efficiently

Review unread messages and organize response workflow:

```javascript
// ✅ Good: Organize message workflow
const threads = await mcp__browser__browser_execute_macro({
  id: "list_message_threads"
});

const unread = threads.content.threads.filter(t => t.hasUnread);

// Process unread messages in order
for (const thread of unread) {
  // Read and respond to each
}
```

---

## Troubleshooting

### Issue: No Applicants Extracted

**Cause**: Page hasn't loaded applicants or wrong page structure

**Solution**:
```javascript
// Wait for page to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Then extract
const applicants = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  tabTarget: tabId
});

if (applicants.content.applicants.length === 0) {
  console.log("Make sure you're on the job applicants page");
}
```

### Issue: Extract Applicant Detail Returns Error

**Cause**: Modal not open or incorrect page structure

**Solution**:
```javascript
// Make sure modal is open
const snapshot = await mcp__browser__browser_snapshot({ tabTarget: tabId });

// Look for modal elements
if (!snapshot.includes("data-test")) {
  console.log("Open an applicant modal first");
}

// Then extract
const details = await mcp__browser__browser_execute_macro({
  id: "extract_applicant_detail",
  tabTarget: tabId
});
```

### Issue: Send Message Fails

**Cause**: Applicant name doesn't match exactly or messaging interface not visible

**Solution**:
```javascript
// Get exact applicant name
const applicants = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  tabTarget: tabId
});

const exactName = applicants.content.applicants[0].name;

// Use exact name
const sent = await mcp__browser__browser_execute_macro({
  id: "send_message_to_applicant",
  params: {
    recipientName: exactName,
    message: "Your message..."
  },
  tabTarget: tabId
});
```

### Issue: Comparison Returns Limited Data

**Cause**: Not all applicants loaded on page yet

**Solution**:
```javascript
// Extract all first
const all = await mcp__browser__browser_execute_macro({
  id: "extract_all_applicants_with_details",
  params: { maxApplicants: 50 },
  tabTarget: tabId
});

// Use applicants from extraction
const comparison = await mcp__browser__browser_execute_macro({
  id: "compare_applicants",
  params: {
    applicants: all.content.applicants.slice(0, 5).map(a => a.name)
  },
  tabTarget: tabId
});
```

### Issue: Message Thread Not Found

**Cause**: Message thread list not loaded or closed

**Solution**:
```javascript
// Make sure messages page is loaded
const threads = await mcp__browser__browser_execute_macro({
  id: "list_message_threads",
  params: { maxThreads: 50 },
  tabTarget: tabId
});

if (!threads.content.success) {
  console.log("Navigate to Upwork messages page first");
}

// Try reading message after thread is open
const messages = await mcp__browser__browser_execute_macro({
  id: "read_message_thread",
  tabTarget: tabId
});
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[AMAZON_MACROS.md](./AMAZON_MACROS.md)** - Amazon-specific macros
- **[GOOGLE_SHOPPING_MACROS.md](./GOOGLE_SHOPPING_MACROS.md)** - Google Shopping macros
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
