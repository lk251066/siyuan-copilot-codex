# AI Sidebar Plugin

A powerful AI assistant plugin for SiYuan Note, featuring multi-platform support, multimodal conversations, document context integration, and rich functionality.

## ✨ Core Features

### 🤖 Multi-Platform AI Support

- **Built-in Platforms**
  - OpenAI (GPT Series)
  - Google Gemini
  - DeepSeek
  - Volcano Engine (Doubao)
  
- **Custom Platforms**
  - Add any OpenAI-compatible API platform
  - Flexible API endpoint and key configuration
  - Support for privately deployed models

### 💬 Intelligent Conversation

- **Multimodal Support**
  - Text conversations
  - Image recognition (paste, upload, drag & drop)
  - File upload (Markdown, text files, etc.)
  - Mixed content types

- **Thinking Mode**
  - Support for models with reasoning process (DeepSeek, OpenAI o1, etc.)
  - Real-time streaming of thinking process
  - Collapsible/expandable detailed thoughts

- **Session Management**
  - Auto-save conversation history
  - Create and switch between sessions
  - Smart session title generation
  - Unsaved changes reminder

### 📚 Document Context Integration

- **Smart Document Search**
  - Search related documents in SiYuan
  - Real-time search preview
  - Quick add to conversation context

- **Multiple Adding Methods**
  - Drag & drop document blocks to sidebar
  - Search and select documents
  - Quick button for current document/block
  - One-click add focused document or block

- **Context Management**
  - View added document list
  - Jump to original document
  - Flexible removal of documents
  - Support multiple documents simultaneously

### 🎯 Prompt Management

- **Prompt Library**
  - Create and save common prompts
  - Edit and delete prompts
  - One-click use of prompt templates
  - Quick insert into input box

- **Convenient Access**
  - Click 📝 icon to open prompt selector
  - Floating display, no workflow interruption
  - Support for prompt management dialog

### ⚙️ Flexible Configuration

- **Model Configuration**
  - Multiple models per platform
  - Independent parameter configuration (temperature, max tokens)
  - Identify special model capabilities (thinking mode, vision support)
  - Quick model switching

- **System Prompt**
  - Customize AI assistant behavior and role
  - Apply to all new sessions
  - Flexible output style adjustment

### 🎨 Excellent User Experience

- **Real-time Streaming Output**
  - Character-by-character AI responses
  - Instant thinking process display
  - Interrupt generation anytime

- **Markdown Rendering**
  - Uses SiYuan's built-in Lute engine
  - Perfect code highlighting
  - Math formula rendering
  - Tables and lists formatting

- **Convenient Operations**
  - One-click message copy
  - Export entire conversation as Markdown
  - Keyboard shortcuts (Ctrl+Enter to send)
  - Responsive design for different screens

## 📥 Installation

1. Search for "AI Sidebar" in SiYuan Marketplace
2. Click install and enable the plugin
3. Configure your AI platform API keys in plugin settings

## 🚀 Quick Start

### 1. Configure AI Platform

- Click plugin settings icon
- Select your AI platform (OpenAI, Gemini, etc.)
- Enter the corresponding API key
- Optional: Configure custom API endpoint
- Select available models and configure parameters

### 2. Start Conversation

- Click AI Assistant icon in sidebar
- Type your question in input box
- Press Ctrl+Enter or click send button
- Wait for AI response

### 3. Add Document Context

**Method 1: Search and Add**
- Click search icon 🔍
- Enter keywords to search documents
- Click search results to add to context

**Method 2: Drag and Drop**
- Drag document block from tree or editor
- Drop onto AI sidebar
- Automatically added to conversation context

**Method 3: Quick Button**
- Click "+" button
- Auto-add current focused document or block

### 4. Use Prompts

- Click 📝 icon to open prompt selector
- Select saved prompts
- Or click "Manage Prompts" to create new templates

### 5. Manage Sessions

- Click 💬 icon to open session manager
- View all history sessions
- Load previous conversations
- Delete unnecessary sessions

## 🎯 Use Cases

### 📝 Writing Assistant
- Add documents you're writing to context
- Let AI help expand, polish, or rewrite content
- Generate outlines and structures

### 🔍 Knowledge Q&A
- Search and add related notes to context
- Ask AI questions based on your knowledge base
- Quickly understand complex concepts

### 🖼️ Image Analysis
- Paste or upload images
- Let AI recognize image content
- Extract text or information from images

### 💡 Creative Generation
- Quick start with prompt templates
- Multi-turn conversations for inspiration
- Save valuable conversation content

### 📚 Document Organization
- Add multiple related documents
- Let AI summarize, organize, or compare
- Generate knowledge cards

## ⚙️ Advanced Configuration

### Custom Platform

If you use other AI platforms or private deployments:

1. Select "Custom Platform" in settings
2. Click "Add Custom Platform"
3. Enter platform name and API configuration
4. Add available models and parameters
5. Save and select for use

### Model Parameters

- **Temperature**: Controls output randomness (0-2)
  - Lower values: More deterministic, consistent
  - Higher values: More creative, diverse
  
- **Max Tokens**: Controls maximum output length
  - Set according to model limits
  - Balance cost and performance

### System Prompt

Customize AI assistant behavior through system prompt:

```
You are a professional knowledge management assistant, skilled at helping users organize and summarize note content.
When answering, please:
1. Keep it concise and clear
2. Use Markdown format
3. Provide actionable suggestions
```

## 🔧 Development

### Local Development

```bash
pnpm install
pnpm run dev
```



## 📄 License

MIT License

## 🙏 Acknowledgments

- Based on [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) template
- Thanks to SiYuan Note team for the excellent plugin system

## 📮 Feedback & Suggestions

For issues or suggestions, please submit at [GitHub Issues](https://github.com/Achuan-2/siyuan-plugin-ai-sidebar/issues).

---

**Note**: Using this plugin requires your own AI platform API keys. The plugin itself does not provide AI services. Please comply with each platform's terms of use and privacy policies.