/* eslint-disable @typescript-eslint/no-unused-vars */
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormProvider,
  useForm,
  type SubmitHandler,
} from "react-hook-form";

import type { Interview } from "@/types";
import { CustomBreadCrumb } from "./custom-bread-crumb";
import { Headings } from "./headings";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import { Loader } from "lucide-react";

import { chatSession } from "@/scripts";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/config/firebase.config";

/* PDF */
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/* --------------------------------------------------
   Schema
-------------------------------------------------- */
const formSchema = z.object({
  position: z.string().min(1),
  description: z.string().min(10),
  experience: z.number().min(0),
  techStack: z.string().min(1),
  resume: z.instanceof(FileList).optional(),
});

type FormData = z.infer<typeof formSchema>;

interface FormMockInterviewProps {
  initialData: Interview | null;
}

/* --------------------------------------------------
   Component
-------------------------------------------------- */
export const FormMockInterview = ({ initialData }: FormMockInterviewProps) => {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const [loading, setLoading] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      position: initialData?.position ?? "",
      description: initialData?.description ?? "",
      experience: initialData?.experience ?? 0,
      techStack: initialData?.techStack ?? "",
      resume: undefined,
    },
    mode: "onChange",
  });

  const { isValid } = form.formState;

  useEffect(() => {
    if (initialData) {
      form.reset({
        position: initialData.position,
        description: initialData.description,
        experience: initialData.experience,
        techStack: initialData.techStack,
        resume: undefined,
      });
    }
  }, [initialData, form]);

  /* --------------------------------------------------
     Helpers
  -------------------------------------------------- */

  const cleanAiResponse = (text: string) => {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    return JSON.parse(text.slice(start, end + 1));
  };

  /* 🔥 Cloudinary Upload */
  const uploadResumeToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "resume_upload"); // create this preset in Cloudinary

    const res = await fetch(
      "https://api.cloudinary.com/v1_1/dmgignx2j/auto/upload",
      {
        method: "POST",
        body: formData,
      }
    );

    if (!res.ok) throw new Error("Cloudinary upload failed");

    const data = await res.json();
    return data.secure_url;
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      text += content.items
        .map((item) =>
          "str" in item ? (item as TextItem).str : ""
        )
        .join(" ");
    }

    return text.slice(0, 4000);
  };

const generateQuestions = async (
  data: FormData,
  resumeText?: string
) => {
  const prompt = `
Return ONLY JSON array:
[
 { "question": "...", "answer": "..." }
]

Position: ${data.position}
Description: ${data.description}
Experience: ${data.experience}
Tech Stack: ${data.techStack}

Resume:
${resumeText || "Not provided"}
`;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const result = await chatSession.sendMessage(prompt);
      return cleanAiResponse(result.response.text());
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("503") &&
        attempts < maxAttempts - 1
      ) {
        attempts++;
        console.log("Gemini busy, retrying...", attempts);
        await new Promise((res) => setTimeout(res, 2000));
      } else {
        throw error;
      }
    }
  }
};



  /* --------------------------------------------------
     Submit
  -------------------------------------------------- */
  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (!userId) {
      toast.error("Login required");
      return;
    }

    try {
      setLoading(true);

      let resumeUrl = initialData?.resumeUrl || "";
      let resumeText = "";

      const file = data.resume?.[0];

      if (file) {
        toast("Uploading resume...");
        resumeUrl = await uploadResumeToCloudinary(file);

        if (file.type === "application/pdf") {
          toast("Analyzing resume...");
          resumeText = await extractTextFromPDF(file);
        }
      }

      toast("Generating questions...");
      const questions = await generateQuestions(data, resumeText);

      /* 🔥 Remove FileList before saving */
      const { resume, ...restData } = data;

      if (initialData) {
        await updateDoc(doc(db, "interviews", initialData.id), {
          ...restData,
          resumeUrl,
          questions,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "interviews"), {
          ...restData,
          resumeUrl,
          questions,
          userId,
          createdAt: serverTimestamp(),
        });
      }

      toast.success("Interview saved");
      navigate("/generate");
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  /* --------------------------------------------------
     Delete
  -------------------------------------------------- */
  const handleDelete = async () => {
    if (!initialData) return;
    if (!confirm("Delete interview?")) return;

    await deleteDoc(doc(db, "interviews", initialData.id));
    navigate("/generate");
  };

  /* --------------------------------------------------
     UI
  -------------------------------------------------- */
  return (
    <div className="space-y-4">
      <CustomBreadCrumb
        breadCrumbPage={initialData ? "Edit" : "Create"}
        breadCrumbItems={[{ label: "Mock Interviews", link: "/generate" }]}
      />

      <Headings title="Mock Interview" isSubHeading />
      <Separator />

      <FormProvider {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="p-6 space-y-6 shadow rounded"
        >
          <FormField
            control={form.control}
            name="position"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Position</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="techStack"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tech Stack</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="resume"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Upload Resume (PDF)</FormLabel>
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={(e) =>
                    field.onChange(e.target.files ?? undefined)
                  }
                />
              </FormItem>
            )}
          />

          <Button disabled={!isValid || loading}>
            {loading ? <Loader className="animate-spin" /> : "Submit"}
          </Button>
        </form>
      </FormProvider>
    </div>
  );
};
