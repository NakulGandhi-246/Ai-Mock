import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TooltipButton } from "./tooltip-button";
import { Volume2, VolumeX } from "lucide-react";
import { RecordAnswer } from "./record-answer";

interface QuestionSectionProps {
  questions: { question: string; answer: string }[];
}

export const QuestionSection = ({ questions }: QuestionSectionProps) => {
  const navigate = useNavigate();

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showQuestion, setShowQuestion] = useState(false);

  // Store all answers
  const [allAnswers, setAllAnswers] = useState<
    { question: string; answer: string; correct: string }[]
  >([]);

  // Cross-question states
  const [isCrossQuestion, setIsCrossQuestion] = useState(false);
  const [crossQuestionText, setCrossQuestionText] = useState("");
  const [tempMainAnswer, setTempMainAnswer] = useState("");

  // ✅ SMART Cross Question Generator (added)
  const generateCrossQuestion = (answer: string) => {
    if (!answer) return "Can you explain that in more detail?";

    const words = answer.toLowerCase().split(/\s+/);

    const stopWords = [
      "is",
      "am",
      "are",
      "was",
      "were",
      "the",
      "a",
      "an",
      "and",
      "or",
      "to",
      "of",
      "in",
      "on",
      "for",
      "with",
      "this",
      "that",
      "it",
      "as",
      "by",
      "from",
    ];

    const keywords = words.filter(
      (word) => word.length > 2 && !stopWords.includes(word)
    );

    const keyword = keywords[keywords.length - 1];

    if (!keyword) {
      return "Can you explain that in more detail?";
    }

    const formattedKeyword =
      keyword.charAt(0).toUpperCase() + keyword.slice(1);

    return `What is ${formattedKeyword}?`;
  };

  const speakQuestion = (text: string) => {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);

    speech.onstart = () => {
      setIsPlaying(true);
      setShowQuestion(false);
    };

    speech.onend = () => {
      setIsPlaying(false);
      setShowQuestion(true);
    };

    window.speechSynthesis.speak(speech);
  };

  // Auto speak when question or cross-question changes
  useEffect(() => {
    if (isCrossQuestion && crossQuestionText) {
      speakQuestion(crossQuestionText);
      return;
    }

    if (!questions[activeIndex]) return;
    speakQuestion(questions[activeIndex].question);
  }, [activeIndex, isCrossQuestion, crossQuestionText, questions]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Next question handler
  const handleNextQuestion = (answer: string) => {
    window.speechSynthesis.cancel();
    setShowQuestion(false);

    // If main question answered → ask cross question
    if (!isCrossQuestion) {
      const crossQ = generateCrossQuestion(answer);
      setTempMainAnswer(answer);
      setCrossQuestionText(crossQ);
      setIsCrossQuestion(true);
      return;
    }

    // If cross question answered → save both answers
    const currentAnswer = {
      question: questions[activeIndex].question,
      answer: `${tempMainAnswer} | Follow-up: ${answer}`,
      correct: questions[activeIndex].answer,
    };

    const updatedAnswers = [...allAnswers, currentAnswer];
    setAllAnswers(updatedAnswers);

    // Reset cross state
    setIsCrossQuestion(false);
    setCrossQuestionText("");
    setTempMainAnswer("");

    // Move to next main question or feedback
    if (activeIndex < questions.length - 1) {
      setActiveIndex((prev) => prev + 1);
    } else {
      navigate("/generate/feedback/demo", {
        state: {
          answers: updatedAnswers,
          questions: questions,
        },
      });
    }
  };

  return (
    <div className="w-full min-h-96 border rounded-md p-4">
      <Tabs
        value={questions[activeIndex]?.question}
        className="w-full space-y-12"
        orientation="vertical"
      >
        {questions[activeIndex] && (
          <TabsContent value={questions[activeIndex].question}>
            {/* Question Text */}
            {showQuestion && (
              <p className="text-base text-left tracking-wide text-neutral-500">
                {isCrossQuestion
                  ? crossQuestionText
                  : questions[activeIndex].question}
              </p>
            )}

            {/* Replay / Stop */}
            <div className="w-full flex justify-end">
              <TooltipButton
                content={isPlaying ? "Stop" : "Replay"}
                icon={
                  isPlaying ? (
                    <VolumeX className="min-w-5 min-h-5 text-muted-foreground" />
                  ) : (
                    <Volume2 className="min-w-5 min-h-5 text-muted-foreground" />
                  )
                }
                onClick={() => {
                  if (isPlaying) {
                    window.speechSynthesis.cancel();
                    setIsPlaying(false);
                    setShowQuestion(true);
                  } else {
                    speakQuestion(
                      isCrossQuestion
                        ? crossQuestionText
                        : questions[activeIndex].question
                    );
                  }
                }}
              />
            </div>

            {/* Answer Section */}
            {showQuestion && (
              <RecordAnswer
                question={
                  isCrossQuestion
                    ? { question: crossQuestionText, answer: "" }
                    : questions[activeIndex]
                }
                questions={questions}
                currentIndex={activeIndex}
                totalQuestions={questions.length}
                onSubmit={handleNextQuestion}
              />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};
