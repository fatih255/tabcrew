// MCP tool catalogue for tabcrew-chrome.
// Names and argument shapes follow the same conventions as other browser-agent MCP servers,
// so prompts written for those work here too. Descriptions are our own.

const tabId = { type: "number", description: "Tab to act on. Must be a tab in the agent's tab group (see tabs_context_mcp)." };
const xy = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };

export const TOOLS = [
  {
    name: "tabs_context_mcp",
    description: "List the tabs in the agent's tab group, with their ids, titles and URLs. Call this first in a session. With createIfEmpty it opens a new window with an agent tab group when none exists. The agent can only act on tabs in this group.",
    inputSchema: { type: "object", properties: { createIfEmpty: { type: "boolean", description: "Create the agent tab group if it does not exist." } } },
  },
  {
    name: "tabs_create_mcp",
    description: "Open a new empty tab inside the agent's tab group and return its tab id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tabs_close_mcp",
    description: "Close a tab that belongs to the agent's tab group.",
    inputSchema: { type: "object", properties: { tabId }, required: ["tabId"] },
  },
  {
    name: "navigate",
    description: 'Load a URL in a tab, or go "back" / "forward" in its history. URLs without a scheme get https://. A "Leave site?" prompt cancels the navigation unless force is true.',
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: 'URL to open, or "back" / "forward".' },
        tabId,
        force: { type: "boolean", description: "Accept a beforeunload 'Leave site?' prompt." },
      },
      required: ["url", "tabId"],
    },
  },
  {
    name: "computer",
    description: [
      "Use the mouse and keyboard on a tab, and take screenshots.",
      "Coordinates are pixels in the most recent screenshot of that tab; take a screenshot before clicking by coordinate.",
      "Instead of a coordinate you can pass ref (from read_page/find) for clicks, hover and scroll_to.",
      "Actions: left_click, right_click, double_click, triple_click, hover, left_click_drag (start_coordinate -> coordinate),",
      "type (text), key (space-separated keys or combos such as \"ctrl+a Backspace Enter\"), scroll (scroll_direction, scroll_amount),",
      "scroll_to (ref), wait (duration seconds, max 10), screenshot (optional scale), zoom (region [x0,y0,x1,y1] for a close-up).",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["left_click", "right_click", "type", "screenshot", "wait", "scroll", "key", "left_click_drag", "double_click", "triple_click", "zoom", "scroll_to", "hover"] },
        tabId,
        coordinate: { ...xy, description: "[x, y] in screenshot pixels. End point for left_click_drag." },
        start_coordinate: { ...xy, description: "[x, y] start point for left_click_drag." },
        ref: { type: "string", description: "Element reference such as ref_12 (alternative to coordinate)." },
        text: { type: "string", description: "Text to type (type) or keys to press (key)." },
        modifiers: { type: "string", description: 'Modifier keys held during clicks, e.g. "ctrl" or "ctrl+shift".' },
        duration: { type: "number", minimum: 0, maximum: 10, description: "Seconds to wait (wait)." },
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
        scroll_amount: { type: "number", minimum: 1, maximum: 10, description: "Scroll wheel ticks (default 3)." },
        region: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "[x0, y0, x1, y1] for zoom." },
        repeat: { type: "number", minimum: 1, maximum: 100, description: "Repeat the key sequence N times (key)." },
        scale: { type: "number", minimum: 0.1, maximum: 1, description: "Return a smaller image (screenshot, zoom). Coordinates stay in the full-size frame." },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "read_page",
    description: "Get an outline of the page: one line per meaningful element with its role, name and a ref id (ref_N) that other tools accept. By default only elements in the viewport are listed; filter \"interactive\" keeps only controls. Pass ref_id to expand one element's subtree.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        filter: { type: "string", enum: ["interactive", "all"], description: '"interactive" for controls only, "all" for everything (default "all").' },
        depth: { type: "number", description: "Maximum tree depth (default 15)." },
        ref_id: { type: "string", description: "Only return the subtree under this ref." },
        max_chars: { type: "number", description: "Maximum output characters (default 50000)." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "find",
    description: 'Find elements by a short natural-language description, e.g. "search box" or "login button". Returns up to 20 matches with ref ids. Works by keyword matching on names, labels, placeholders and ids.',
    inputSchema: { type: "object", properties: { query: { type: "string" }, tabId }, required: ["query", "tabId"] },
  },
  {
    name: "form_input",
    description: "Set the value of a form field by ref: text inputs and textareas (string), selects (option value or text), checkboxes (boolean), radios.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: ["string", "boolean", "number"] }, tabId },
      required: ["ref", "value", "tabId"],
    },
  },
  {
    name: "get_page_text",
    description: "Return the readable text of the page (article/main content when present, otherwise the body).",
    inputSchema: { type: "object", properties: { tabId, max_chars: { type: "number", description: "Default 50000." } }, required: ["tabId"] },
  },
  {
    name: "javascript_tool",
    description: "Run JavaScript in the page and return the value of the last expression (top-level await works). Values that look like secrets are redacted in the result.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["javascript_exec"] }, text: { type: "string", description: "Code to run." }, tabId },
      required: ["action", "text", "tabId"],
    },
  },
  {
    name: "read_console_messages",
    description: "Read console messages and uncaught exceptions from a tab. Capture starts the first time this is called on a tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        onlyErrors: { type: "boolean" },
        clear: { type: "boolean", description: "Clear the buffer after reading." },
        pattern: { type: "string", description: "Case-insensitive regex filter." },
        limit: { type: "number", description: "Default 100." },
      },
      required: ["tabId"],
    },
  },
  {
    name: "read_network_requests",
    description: "List network requests made by a tab (URL, method, status). Capture starts the first time this is called on a tab.",
    inputSchema: {
      type: "object",
      properties: { tabId, urlPattern: { type: "string", description: "Substring filter." }, clear: { type: "boolean" }, limit: { type: "number", description: "Default 100." } },
      required: ["tabId"],
    },
  },
  {
    name: "resize_window",
    description: "Resize the browser window that contains the tab.",
    inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" }, tabId }, required: ["width", "height", "tabId"] },
  },
  {
    name: "file_upload",
    description: "Put local files into an <input type=file> found by ref. Give absolute file paths; the MCP server reads them (10 MB total).",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, tabId, paths: { type: "array", items: { type: "string" }, description: "Absolute paths of local files." } },
      required: ["ref", "tabId", "paths"],
    },
  },
  {
    name: "upload_image",
    description: "Upload a screenshot taken earlier (by its ss_ id) into a file input (ref) or drop it onto a point (coordinate).",
    inputSchema: {
      type: "object",
      properties: { imageId: { type: "string" }, tabId, ref: { type: "string" }, coordinate: xy, filename: { type: "string", description: 'Default "image.png".' } },
      required: ["imageId", "tabId"],
    },
  },
  {
    name: "gif_creator",
    description: [
      "Record the agent's browser actions as an animated GIF.",
      "start_recording begins capturing a frame after every computer/navigate action on tabs in the agent group (clicks are marked, each frame is labelled with its action);",
      "stop_recording ends capture; export encodes the GIF and saves it to a local file (path, default: the user's Downloads folder); clear drops the frames.",
      "Up to 100 frames, at most 800 px wide.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start_recording", "stop_recording", "export", "clear"] },
        tabId,
        path: { type: "string", description: "export: absolute output file or folder path. Default: Downloads/<filename>." },
        filename: { type: "string", description: 'export: file name (default "recording-<time>.gif").' },
        options: {
          type: "object",
          description: "export options",
          properties: {
            showClickIndicators: { type: "boolean", description: "Mark click positions (default true)." },
            showActionLabels: { type: "boolean", description: "Caption each frame with its action (default true)." },
            frameDelayMs: { type: "number", description: "Time each frame is shown (default 800, last frame 2000)." },
          },
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: "browser_batch",
    description: "Run several browser tool calls in order in one round trip, e.g. click, type, press Enter, screenshot. Stops at the first error. Each action is {name, input} where input is what that tool takes on its own. Cannot be nested.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { name: { type: "string" }, input: { type: "object" } }, required: ["name", "input"] },
        },
      },
      required: ["actions"],
    },
  },
  // ---- AI chat sites (ChatGPT, Gemini, DeepSeek): the site is detected from the tab's URL ----
  {
    name: "chat_sites",
    description: "List the AI chat sites the chat_* tools support, with the URL that starts a new chat and what each can do (images, toggles).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chat_status",
    description: "State of the AI chat in a tab: loggedIn, ready, generating (still writing), messages, assistantCount, toggles. Use it after opening a chat site and before sending.",
    inputSchema: { type: "object", properties: { tabId }, required: ["tabId"] },
  },
  {
    name: "chat_send",
    description: "Type a message into the AI chat in a tab and send it. Give the message as text, or as path (a local UTF-8 text file, read exactly; best for long or relayed text). Returns ok, or err: still_generating, too_long (with max: split the message), site_error (note), no_textarea, send_not_confirmed. To attach files first, use find (\"hidden file input\") and file_upload.",
    inputSchema: { type: "object", properties: { tabId, text: { type: "string" }, path: { type: "string", description: "Absolute path of a text file to send instead of text." } }, required: ["tabId"] },
  },
  {
    name: "chat_read",
    description: "Wait for the chat's reply and return it as text (markdown, the final answer only, never hidden reasoning). mode after_send (default: the reply to the last chat_send in this page; falls back to last after a reload) or last (the newest reply). Waits up to wait seconds (default 90); while it still says generating, call again. With path the exact reply is saved to that local file instead of being returned (read the file when you need it). The result may carry warn (the reply may not match the page) or canvas:true (part of the reply went to a side panel).",
    inputSchema: { type: "object", properties: { tabId, mode: { type: "string", enum: ["after_send", "last"] }, wait: { type: "number", description: "Seconds to wait, 1-100." }, path: { type: "string", description: "Absolute path of a file to save the reply to." } }, required: ["tabId"] },
  },
  {
    name: "chat_images",
    description: "List the images the chat generated in a reply: count and size of each. mode after_send or last (default after_send). Waits up to wait seconds while it is still drawing. count 0 means a text reply: read it with chat_read.",
    inputSchema: { type: "object", properties: { tabId, mode: { type: "string", enum: ["after_send", "last"] }, wait: { type: "number" } }, required: ["tabId"] },
  },
  {
    name: "chat_save_image",
    description: "Save generated image index (0 = first, as listed by chat_images) of a reply to a local folder, at full size, with no download dialog. path: an absolute folder (or file path). name: file name without extension (the extension follows the image type). Existing files are never overwritten. mode after_send or last (default last: the newest reply). source in the result says whether the full-size file or only the preview was saved.",
    inputSchema: { type: "object", properties: { tabId, index: { type: "number" }, mode: { type: "string", enum: ["after_send", "last"] }, path: { type: "string" }, name: { type: "string" } }, required: ["tabId", "path"] },
  },
  {
    name: "chat_toggle",
    description: "Turn a chat option on or off by its visible label (a case-insensitive pattern), for example DeepSeek's DeepThink or Search. chat_status lists the toggles.",
    inputSchema: { type: "object", properties: { tabId, name: { type: "string" }, on: { type: "boolean" } }, required: ["tabId", "name", "on"] },
  },
];

// Tools answered by the MCP server itself (they choose which browser the other tools go to).
export const SERVER_TOOLS = [
  {
    name: "list_connected_browsers",
    description: "List the browsers (Chrome profiles) that currently have the tabcrew-chrome extension connected, with their browserId, name and which one is selected. Use it when several browsers may be open.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "select_browser",
    description: "Send all following browser tool calls to one connected browser, by its browserId (or its name) from list_connected_browsers. Needed when more than one browser is connected.",
    inputSchema: { type: "object", properties: { browserId: { type: "string", description: "browserId or name from list_connected_browsers." } }, required: ["browserId"] },
  },
];
