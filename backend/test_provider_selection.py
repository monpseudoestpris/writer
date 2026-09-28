import backend.main as main
from backend.prompts import HUMAN_STYLE_PREFIX, with_human_style
from backend.mistral_utils import get_mistral_generation_kwargs


def test_human_style_prefix_is_added_once():
    styled = with_human_style("Tu réponds en français.")

    assert styled.startswith(HUMAN_STYLE_PREFIX)
    assert styled.count(HUMAN_STYLE_PREFIX) == 1


def test_mistral_generation_kwargs_include_compatible_sampling():
    params = get_mistral_generation_kwargs()

    assert params["temperature"] == 0.8
    assert params["top_p"] == 0.9
    assert params["frequency_penalty"] == 0.3
    assert params["presence_penalty"] == 0.2


def test_pick_random_provider_uses_only_available_candidates(monkeypatch):
    monkeypatch.setattr(
        main.os,
        "getenv",
        lambda key, default=None: {
            "ANTHROPIC_API_KEY": "anthropic-key",
            "DEEPSEEK_API_KEY": "deepseek-key",
            "MISTRAL_API_KEY": "mistral-key",
            "OPENAI_API_KEY": "openai-key",
        }.get(key),
    )
    called = []

    def fake_choice(seq):
        called.append(seq)
        return seq[2]

    monkeypatch.setattr(main.random, "choice", fake_choice)

    selected = main._pick_random_provider([
        ("ANTHROPIC_API_KEY", object(), "claude-sonnet-5"),
        ("DEEPSEEK_API_KEY", object(), "deepseek-v4-pro"),
        ("MISTRAL_API_KEY", object(), "mistral-large-latest"),
        ("OPENAI_API_KEY", object(), "gpt-5.2"),
    ])

    assert selected[1] == "mistral-large-latest"
    assert selected[2] == "mistral"
    assert called and len(called[0]) == 4


def test_pick_random_provider_falls_back_when_none_available(monkeypatch):
    monkeypatch.setattr(main.os, "getenv", lambda key, default=None: None)

    selected = main._pick_random_provider([
        ("ANTHROPIC_API_KEY", object(), "claude-sonnet-5"),
        ("MISTRAL_API_KEY", object(), "mistral-large-latest"),
    ])

    assert selected[1] in {"claude-sonnet-5", "mistral-large-latest"}
    assert selected[2] in {"anthropic", "mistral"}
