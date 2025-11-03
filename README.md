# AI Sidebar Plugin

An AI assistant plugin for SiYuan Note, supporting multiple AI platforms, document context integration, and rich features.

## ✨ Core Features

### 🤖 Multi-Platform AI Support

- **Built-in Platform Support**
  - OpenAI (GPT Series)
  - Google Gemini
  - DeepSeek
  - Volcano Engine (Doubao)
  
- **Custom Platforms**
  - Support adding any OpenAI-compatible API platform
  - Flexible API endpoint and key configuration
  - Support for privately deployed large language models

### 💬 Intelligent Conversation Features

- **Multimodal Support**
  - Text conversations
  - Image recognition (paste, upload, drag & drop)
  - File upload (Markdown, text files, etc.)
  - Mixed input of multiple content types

- **Thinking Mode Support**
  - Support for models with thinking processes like DeepSeek, OpenAI o1 series
  - Real-time streaming display of thinking process
  - Collapsible/expandable detailed thinking content

- **Session Management**
  - Auto-save conversation history
  - Create and switch between multiple sessions
  - Smart session title generation
  - Unsaved changes reminder

### 📚 Document Context Integration

- **Smart Document Search**
  - Search related documents in SiYuan Note and quickly add them to conversation context

- **Multiple Adding Methods**
  - Drag and drop document blocks to sidebar
  - Search and select documents
  - Directly drag tabs and blocks to add current document/block

- **Context Management**
  - View list of added documents
  - One-click jump to original document
  - Flexibly remove unwanted documents
  - Support adding multiple documents simultaneously

### 🎯 Prompt Management

- **Prompt Library**
  - Create and save commonly used prompts
  - Edit and delete prompts
  - One-click use of prompt templates
  - Quick insert into input box

- **Convenient Access**
  - Click 📝 icon to open prompt selector
  - Floating display without interrupting workflow
  - Support for prompt management dialog

### ⚙️ Flexible Configuration Options

- **Model Configuration**
  - Each platform supports multiple models
  - Independent configuration of parameters for each model (temperature, max tokens)
  - Identify special model capabilities (thinking mode, vision support)
  - Quick switching between different models

- **System Prompt**
  - Customize AI assistant behavior and role
  - Apply to all new sessions
  - Flexibly adjust output style




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


## 📮 Feedback & Suggestions

For issues or suggestions, please submit at [GitHub Issues](https://github.com/Achuan-2/siyuan-plugin-ai-sidebar/issues).

---

**Note**: Using this plugin requires your own AI platform API keys. The plugin itself does not provide AI services. Please comply with each platform's terms of use and privacy policies.