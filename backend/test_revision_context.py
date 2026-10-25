import asyncio

import pytest

from backend import main
from backend.models import ClassroomAuthorJudgmentRequest, ClassroomPeerReviewRequest, ClassroomTeacherRequest
from backend.revision_context import build_revision_context


def test_missing_and_unchanged_drafts_do_not_claim_progress():
    request = ClassroomTeacherRequest(text="La tasse est froide.", exercise_prompt="Décrire")
    assert "Aucune version précédente" in build_revision_context(request)
    request.previous_text = "La tasse est froide."
    assert "identique" in build_revision_context(request)
    assert "RELECTURE APRÈS RÉÉCRITURE" not in build_revision_context(request)


@pytest.mark.parametrize("role", ["author", "peers", "teacher"])
def test_all_workshop_review_routes_receive_the_previous_draft(monkeypatch, role):
    captured = []

    async def fake_stream(text, prompt, model):
        captured.append((text, prompt))
        yield "Retour sur les changements"

    monkeypatch.setattr(main, "stream_critique_from_anthropic", fake_stream)
    monkeypatch.setattr(main, "stream_critique_from_openai", fake_stream)
    fields = dict(
        text="La tasse me brûle les doigts.", exercise_prompt="Décrire une tasse",
        previous_text="La tasse est chaude.", previous_feedback="Rends la sensation concrète.",
        previous_feedback_source="peers",
    )
    if role == "author":
        request = ClassroomAuthorJudgmentRequest(**fields, author_id=next(iter(main.AUTHORS)))
        route = main.classroom_author_judgment
    elif role == "peers":
        request = ClassroomPeerReviewRequest(**fields, student_ids=["kevin"])
        route = main.classroom_peer_review
    else:
        request = ClassroomTeacherRequest(**fields)
        route = main.classroom_teacher_critique

    async def collect():
        response = await route(request)
        return "".join([part async for part in response.body_iterator])

    assert "Retour sur les changements" in asyncio.run(collect())
    text, prompt = captured[0]
    assert text == fields["text"]
    assert fields["previous_text"] in prompt
    assert fields["previous_feedback"] in prompt
    assert "RELECTURE APRÈS RÉÉCRITURE" in prompt
