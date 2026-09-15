"""Single source of truth for backend AI model identifiers."""


def _provider_model(provider: str, model: str) -> str:
    return f"{provider}:{model}"


# Mistral
MISTRAL_BEST_MODEL = "mistral-large-latest"
MISTRAL_MEDIUM_MODEL = "mistral-medium-latest"
MISTRAL_FAST_MODEL = "mistral-small-latest"
MISTRAL_VISION_MODEL = "pixtral-large-latest"
MISTRAL_OCR_MODEL = "mistral-ocr-4-1"
MISTRAL_TTS_MODEL = "voxtral-mini-tts-latest"
MISTRAL_TRANSCRIPTION_MODEL = "voxtral-mini-latest"
MISTRAL_REASONING_MODEL = "magistral-medium-2509"

MISTRAL_BEST_AGENT = _provider_model("mistral", MISTRAL_BEST_MODEL)
MISTRAL_MEDIUM_AGENT = _provider_model("mistral", MISTRAL_MEDIUM_MODEL)
MISTRAL_FAST_AGENT = _provider_model("mistral", MISTRAL_FAST_MODEL)
MISTRAL_VISION_AGENT = _provider_model("mistral", MISTRAL_VISION_MODEL)
MISTRAL_REASONING_AGENT = _provider_model("magistral", MISTRAL_REASONING_MODEL)

# OpenAI
OPENAI_BEST_MODEL = "gpt-5.6-luna"
OPENAI_MEDIUM_MODEL = "gpt-5.2"
OPENAI_STANDARD_MODEL = "gpt-4o"
OPENAI_FAST_MODEL = "gpt-4o-mini"
OPENAI_REASONING_MODEL = "o1"
OPENAI_IMAGE_MODEL = "gpt-image-1"
OPENAI_LEGACY_IMAGE_MODEL = "dall-e-3"
OPENAI_TTS_MODEL = "tts-1"
OPENAI_TRANSCRIPTION_MODEL = "whisper-1"

OPENAI_BEST_AGENT = _provider_model("openai", OPENAI_BEST_MODEL)
OPENAI_MEDIUM_AGENT = _provider_model("openai", OPENAI_MEDIUM_MODEL)
OPENAI_STANDARD_AGENT = _provider_model("openai", OPENAI_STANDARD_MODEL)
OPENAI_FAST_AGENT = _provider_model("openai", OPENAI_FAST_MODEL)
OPENAI_REASONING_AGENT = _provider_model("openai", OPENAI_REASONING_MODEL)

# Anthropic
ANTHROPIC_BEST_MODEL = "claude-opus-5"
ANTHROPIC_MEDIUM_MODEL = "claude-sonnet-5"
ANTHROPIC_FALLBACK_MODEL = "claude-sonnet-4-5"
ANTHROPIC_FAST_MODEL = "claude-haiku-4-5"
ANTHROPIC_COMPATIBILITY_ALIAS = "claude-3-5-sonnet"
ANTHROPIC_COMPATIBILITY_MODEL = "claude-3-5-sonnet-20241022"

ANTHROPIC_BEST_AGENT = _provider_model("anthropic", ANTHROPIC_BEST_MODEL)
ANTHROPIC_MEDIUM_AGENT = _provider_model("anthropic", ANTHROPIC_MEDIUM_MODEL)
ANTHROPIC_FALLBACK_AGENT = _provider_model("anthropic", ANTHROPIC_FALLBACK_MODEL)
ANTHROPIC_FAST_AGENT = _provider_model("anthropic", ANTHROPIC_FAST_MODEL)

# DeepSeek
DEEPSEEK_BEST_MODEL = "deepseek-v4-pro"
DEEPSEEK_FAST_MODEL = "deepseek-v4-flash"
DEEPSEEK_REASONING_MODEL = "deepseek-reasoner"
DEEPSEEK_CHAT_MODEL = "deepseek-chat"

DEEPSEEK_BEST_AGENT = _provider_model("deepseek", DEEPSEEK_BEST_MODEL)
DEEPSEEK_FAST_AGENT = _provider_model("deepseek", DEEPSEEK_FAST_MODEL)
DEEPSEEK_REASONING_AGENT = _provider_model("deepseek", DEEPSEEK_REASONING_MODEL)
DEEPSEEK_CHAT_AGENT = _provider_model("deepseek", DEEPSEEK_CHAT_MODEL)

# Google
GOOGLE_FAST_MODEL = "gemini-2-flash-lite"
GOOGLE_IMAGE_MODEL = "gemini-2.5-flash-image"
GOOGLE_BEST_IMAGE_MODEL = "gemini-3-pro-image-preview"
GOOGLE_IMAGE_GENERATION_MODEL = "imagen-4.0-generate-001"

GOOGLE_FAST_AGENT = _provider_model("google", GOOGLE_FAST_MODEL)

ALL_MODEL_IDS = frozenset(
    value
    for name, value in globals().copy().items()
    if name.isupper() and isinstance(value, str)
)