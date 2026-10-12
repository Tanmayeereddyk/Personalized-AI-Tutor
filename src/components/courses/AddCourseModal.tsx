import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import type { Course, CourseColor, CourseIcon } from "@/lib/types";
import { Modal, Label, courseIcons, courseColorBg, courseColorText } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

const colors: CourseColor[] = ["mint", "sky", "amber", "rose", "violet", "lime"];
const icons = Object.keys(courseIcons) as CourseIcon[];

interface CourseFormValues {
  name: string;
  code: string;
  description?: string | undefined;
  color: CourseColor;
  icon: CourseIcon;
}

function CourseForm({
  initial,
  submitLabel,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: CourseFormValues;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (values: CourseFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState<CourseColor>(initial?.color ?? "mint");
  const [icon, setIcon] = useState<CourseIcon>(initial?.icon ?? "book");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim() || saving) return;
    onSubmit({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || undefined,
      color,
      icon,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div>
        <Label>Course name</Label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design & Analysis of Algorithms" autoFocus />
      </div>
      <div>
        <Label>Course code</Label>
        <input className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CSE201" />
      </div>
      <div>
        <Label>Description</Label>
        <textarea className="field min-h-20 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Color</Label>
          <div className="flex gap-2">
            {colors.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c}
                className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-popover transition", courseColorBg[c], color === c && "ring-2 ring-foreground")} />
            ))}
          </div>
        </div>
        <div>
          <Label>Icon</Label>
          <div className="flex gap-1.5">
            {icons.map((i) => {
              const I = courseIcons[i];
              return (
                <button key={i} type="button" onClick={() => setIcon(i)} aria-label={i}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-lg border transition", icon === i ? cn("bg-secondary", courseColorText[color], "border-foreground/30") : "text-muted-foreground hover:text-foreground")}>
                  <I className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || !code.trim() || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}
        </button>
      </div>
    </form>
  );
}

export function AddCourseModal() {
  const { addCourseOpen, setAddCourseOpen, createCourse } = useStore();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: CourseFormValues) => {
    setSaving(true);
    setError(null);
    try {
      const c = await createCourse({
        name: values.name,
        code: values.code,
        description: values.description,
        color: values.color,
        icon: values.icon,
      });
      setAddCourseOpen(false);
      toast.success("Course created.");
      navigate({ to: "/courses/$courseId", params: { courseId: c.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the course.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={addCourseOpen} onOpenChange={setAddCourseOpen} title="Add a new course" description="Set up a space for your materials, notes and practice.">
      <CourseForm submitLabel="Create Course" saving={saving} error={error} onSubmit={submit} onCancel={() => setAddCourseOpen(false)} />
    </Modal>
  );
}

export function EditCourseModal({
  course,
  open,
  onOpenChange,
}: {
  course: Course;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { updateCourse } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: CourseFormValues) => {
    setSaving(true);
    setError(null);
    try {
      await updateCourse(course.id, {
        name: values.name,
        code: values.code,
        description: values.description,
        color: values.color,
        icon: values.icon,
      });
      onOpenChange(false);
      toast.success("Course updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update the course.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Edit course" description="Update the details shown across StudyAI.">
      <CourseForm
        initial={{
          name: course.name,
          code: course.code,
          description: course.description ?? "",
          color: course.color,
          icon: course.icon,
        }}
        submitLabel="Save changes"
        saving={saving}
        error={error}
        onSubmit={submit}
        onCancel={() => onOpenChange(false)}
      />
    </Modal>
  );
}
