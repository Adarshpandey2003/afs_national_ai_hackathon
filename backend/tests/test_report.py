from pathlib import Path

from afs.pipeline import renumber_open_questions
from afs.render import render_markdown
from afs.schemas import Question, Report, UserAnswer

OUTPUTS = Path(__file__).resolve().parents[2] / "outputs"


def q(qid: str, priority: int) -> Question:
    return Question(question_id=qid, text=f"question {qid}", priority=priority, why_it_matters="w", affects="method")


def test_open_questions_sorted_and_distinct_from_answered_ids():
    questions = [q("q2.1", 2), q("q2.4", 1), q("q2.2", 3), q("q1", 1)]
    renumber_open_questions(questions)
    assert [x.question_id for x in questions] == ["open-1", "open-2", "open-3", "open-4"]
    assert [x.priority for x in questions] == [1, 1, 2, 3]
    assert not {x.question_id for x in questions} & {"q1", "q2", "q3"}  # answered round-1 ids never collide


def test_saved_reports_still_load_and_answers_render_with_their_question():
    saved = sorted(OUTPUTS.glob("*.json"))
    assert saved, "run run_eval.py first"
    report = Report.model_validate_json(saved[0].read_text(encoding="utf-8"))  # written before UserAnswer.question
    report.user_answers = [UserAnswer(question_id="q1", question="What is the nitrate limit?", answer="25 mg/L"),
                           UserAnswer(question_id="q2", answer="after filtration")]
    text = render_markdown(report)
    assert "Q: What is the nitrate limit? → A: 25 mg/L" in text
    assert "Q: q2 → A: after filtration" in text  # older answers without question text fall back to the id
