/* eslint-disable @typescript-eslint/no-unused-vars */
import { useAuth } from "@clerk/clerk-react";
import {
  CircleStop,
  Loader,
  Mic,
  RefreshCw,
  Save,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import useSpeechToText from "react-hook-speech-to-text";
import type { ResultType } from "react-hook-speech-to-text";
import { useParams } from "react-router-dom";
import { TooltipButton } from "./tooltip-button";
import { toast } from "sonner";
import { chatSession } from "@/scripts";
import { SaveModal } from "./save-modal";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/config/firebase.config";
import ProctoringCamera from "@/components/proctoringCamera";

// ===== Props =====
interface RecordAnswerProps {
  question: { question: string; answer: string };
  questions: { question: string; answer: string }[];
  currentIndex: number;
  totalQuestions: number;
  onSubmit: (answer: string) => void;
}

interface AIResponse {
  ratings: number;
  feedback: string;
}

export const RecordAnswer = ({
  question,
  questions,
  currentIndex,
  totalQuestions,
  onSubmit,
}: RecordAnswerProps) => {
  const {
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
  } = useSpeechToText({
    continuous: true,
    useLegacyResults: false,
  });

  const [userAnswer, setUserAnswer] = useState("");
  const [allAnswers, setAllAnswers] = useState<string[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const MIN_RECORD_TIME = 30;
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { userId } = useAuth();
  const { interviewId } = useParams();

  const isLastQuestion = currentIndex === totalQuestions - 1;

  // ===== Overall AI Feedback =====
  const generateOverallResult = async (
    allQuestions: { question: string; answer: string }[],
    answers: string[]
  ): Promise<AIResponse> => {
    setIsAiGenerating(true);

    const combinedText = allQuestions
      .map(
        (q, i) => `
Q${i + 1}: ${q.question}
User Answer: ${answers[i] || ""}
Correct Answer: ${q.answer}
`
      )
      .join("\n");

    const prompt = `
You are an interview evaluator.

Evaluate the candidate based on all answers.

${combinedText}

Return JSON:
{
  "ratings": number,
  "feedback": string
}
`;

    try {
      const aiRes = await chatSession.sendMessage(prompt);
      const text = aiRes.response.text().replace(/(json|```|`)/g, "").trim();
      return JSON.parse(text);
    } catch {
      toast.error("Error generating overall feedback");
      return { ratings: 0, feedback: "Unable to generate feedback" };
    } finally {
      setIsAiGenerating(false);
    }
  };

  // ===== Start / Stop Recording =====
  const recordUserAnswer = async () => {
    if (isRecording) {
      stopSpeechToText();

      // Clean undefined after stop
      setUserAnswer((prev) =>
        prev.replace(/undefined/g, "").trim()
      );

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (recordingTime < MIN_RECORD_TIME) {
        toast.error(`Minimum ${MIN_RECORD_TIME} seconds recording required`);
        return;
      }

      if (userAnswer.trim().length < 30) {
        toast.error("Your answer should be more than 30 characters");
        return;
      }

      const updatedAnswers = [...allAnswers, userAnswer];
      setAllAnswers(updatedAnswers);

      if (isLastQuestion) {
        const result = await generateOverallResult(questions, updatedAnswers);
        setAiResult(result);
      } else {
        toast.success("Answer recorded");
      }
    } else {
      setUserAnswer("");
      setRecordingTime(0);
      startSpeechToText();

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
  };

  // ===== Save Answer =====
  const saveUserAnswer = async () => {
    if (recordingTime < MIN_RECORD_TIME) {
      toast.error("Complete minimum recording first");
      return;
    }

    setLoading(true);

    try {
      await addDoc(collection(db, "userAnswers"), {
        mockIdRef: interviewId,
        question: question.question,
        correct_ans: question.answer,
        user_ans: userAnswer,
        overall_feedback: aiResult?.feedback || "",
        overall_rating: aiResult?.ratings || 0,
        userId,
        attemptAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      toast.success("Answer saved");

      setUserAnswer("");
      setRecordingTime(0);
      stopSpeechToText();
      setOpen(false);

      setTimeout(() => {
        onSubmit(userAnswer);
      }, 300);
    } catch {
      toast.error("Error saving answer");
    } finally {
      setLoading(false);
    }
  };

  // ===== Combine Speech (FINAL FIX) =====
  useEffect(() => {
    const transcript = results
      .filter((r): r is ResultType => typeof r !== "string")
      .map((r) => r.transcript)
      .join(" ");

    const finalText = [transcript, interimResult]
      .filter((text) => text && text !== "undefined")
      .join(" ")
      .replace(/undefined/g, "")
      .trim();

    setUserAnswer(finalText);
  }, [results, interimResult]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="w-full flex flex-col items-center gap-8 mt-4">
      <SaveModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={saveUserAnswer}
        loading={loading}
      />

      <div className="flex items-center justify-center gap-3">
        <TooltipButton
          content={isRecording ? "Stop Recording" : "Start Recording"}
          icon={isRecording ? <CircleStop /> : <Mic />}
          onClick={recordUserAnswer}
        />

        <TooltipButton
          content="Record Again"
          icon={<RefreshCw />}
          onClick={recordUserAnswer}
        />

        <TooltipButton
          content="Save Result"
          icon={
            isAiGenerating ? (
              <Loader className="animate-spin" />
            ) : (
              <Save />
            )
          }
          onClick={() => setOpen(true)}
          disabled={
            recordingTime < MIN_RECORD_TIME ||
            (isLastQuestion && !aiResult)
          }
        />
      </div>

      {/* User Answer */}
      <div className="w-full mt-4 p-4 border rounded-md bg-gray-50">
        <h2 className="text-lg font-semibold">Your Answer:</h2>
        <p className="text-sm mt-2 text-gray-700">
          {userAnswer || "Start recording to see your answer here"}
        </p>
      </div>

      {/* Overall Feedback */}
      {isLastQuestion && aiResult && (
        <div className="w-full p-4 border rounded-md bg-green-50">
          <h2 className="text-lg font-semibold">
            Overall Interview Result
          </h2>
          <p className="mt-2 font-medium">
            Rating: {aiResult.ratings}/10
          </p>
          <p className="text-sm mt-2 text-gray-700">
            {aiResult.feedback}
          </p>
        </div>
      )}

      {/* Proctoring Camera */}
      <div className="w-full h-[300px] md:w-96 flex items-center justify-center border p-2 bg-gray-50 rounded-md">
        <ProctoringCamera />
      </div>
    </div>
  );
};
