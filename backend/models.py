from pydantic import BaseModel
from typing import Optional

class ReviewRequest(BaseModel):
    text: str
    reviewer: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    previous_critiques: Optional[list[dict]] = None
    text_changed: bool = False

class ReviewResponse(BaseModel):
    reviewer: str
    critique: str
    suggestions: list[str]

class SummarizeRequest(BaseModel):
    critique: str

class DialogueRequest(BaseModel):
    text: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    num_authors: int = 3

class ReadersReviewRequest(BaseModel):
    text: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    num_readers: int = 5

class WorldBuildingFeedbackRequest(BaseModel):
    entry_title: str
    entry_content: str
    category: str
    reviewer: Optional[str] = None
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None

class SummarizeTextRequest(BaseModel):
    text: str

class WorldBuildingAutoFillRequest(BaseModel):
    entry_title: str
    entry_content: Optional[str] = None
    category: str
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None

class WBReadersReviewRequest(BaseModel):
    entry_title: str
    entry_content: str
    category: str
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None
    num_readers: int = 5

class PanelReviewRequest(BaseModel):
    text: str
    reviewer_ids: list[str]
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None

class WBPanelReviewRequest(BaseModel):
    entry_title: str
    entry_content: str
    category: str
    reviewer_ids: list[str]
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None

class PanelAnalyzeRequest(BaseModel):
    text: str
    reviewer_ids: list[str]
    reader_feedback: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None

class WBPanelAnalyzeRequest(BaseModel):
    entry_title: str
    entry_content: str
    category: str
    reviewer_ids: list[str]
    reader_feedback: str
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatSummarizeRequest(BaseModel):
    messages: list[ChatMessage]

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    chat_summaries: Optional[list[str]] = None  # accumulated summaries of past exchanges
    # Who are we chatting with
    reviewer_id: Optional[str] = None  # Single reviewer
    reviewer_ids: Optional[list[str]] = None  # Panel
    # Context type
    context_type: str  # "chapter" or "world_building"
    # Original content
    text: str
    # Initial feedback (the critique that started the conversation)
    initial_feedback: str
    # Chapter context
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    # WB context
    entry_title: Optional[str] = None
    category: Optional[str] = None
    all_entries_context: Optional[str] = None

class RewriteRequest(BaseModel):
    text: str
    instructions: Optional[str] = None  # user instructions for the rewrite
    context_type: str  # "chapter" or "world_building"
    # Reviewer(s)
    reviewer_id: Optional[str] = None
    reviewer_ids: Optional[list[str]] = None
    # Context
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    entry_title: Optional[str] = None
    category: Optional[str] = None
    all_entries_context: Optional[str] = None


# ==========================================
# CLASSE D'ÉCRITURE CRÉATIVE ("J'apprends")
# ==========================================

class ClassroomExerciseRequest(BaseModel):
    previous_exercise_titles: Optional[list[str]] = None  # to avoid repeats
    past_syntheses: Optional[list[dict]] = None  # [{title, synthesis}] from the student's progress record


class ClassroomPeerReviewRequest(BaseModel):
    text: str
    exercise_prompt: str
    num_students: int = 5
    student_ids: Optional[list[str]] = None  # force specific students instead of random pick


class ClassroomTeacherRequest(BaseModel):
    text: str
    exercise_prompt: str
    peer_comments: Optional[str] = None  # provided when students already reviewed
    on_demand: bool = False  # True if the student asks for help mid-exercise
    past_syntheses: Optional[list[dict]] = None  # [{title, synthesis}] from the student's progress record


class ClassroomSynthesisRequest(BaseModel):
    exercise_prompt: str
    critique: str  # the teacher's final critique to summarize into the progress record


