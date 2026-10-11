import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import type { CourseColor, CourseIcon } from "@/lib/types";
import { Modal, Label, courseIcons, courseColorBg, courseColorText } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

const colors: CourseColor[] = ["mint", "sky", "amber", "rose", "violet", "lime"];
const icons = Object.keys(courseIcons) as CourseIcon[];

export function AddCourseModal() {
  const { addCourseOpen, setAddCourseOpen, addCourse } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<CourseColor>("mint");
  const [icon, setIcon] = useState<CourseIcon>("book");

  const reset = () => {
    setName("");
    setCode("");
    setDescription("");
    setColor("mint");
    setIcon("book");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    const c = addCourse({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description,
      color,
      icon,
    });
    setAddCourseOpen(false);
    reset();
    navigate({ to: "/courses/$courseId", params: { courseId: c.id } });
  };

  return (
    <Modal
      open={addCourseOpen}
      onOpenChange={setAddCourseOpen}
      title="Add a new course"
      description="Set up a space for your materials, notes and practice."
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <Label>Course name</Label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Design & Analysis of Algorithms"
            autoFocus
          />
        </div>
        <div>
          <Label>Course code</Label>
          <input
            className="field"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. CSE201"
          />
        </div>
        <div>
          <Label>Description</Label>
          <textarea
            className="field min-h-20 resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label>Color</Label>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 ring-offset-popover transition",
                    courseColorBg[c],
                    color === c && "ring-2 ring-foreground",
                  )}
                />
              ))}
            </div>
          </div>
          <div>
            <Label>Icon</Label>
            <div className="flex gap-1.5">
              {icons.map((i) => {
                const I = courseIcons[i];
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIcon(i)}
                    aria-label={i}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg border transition",
                      icon === i
                        ? cn("bg-secondary", courseColorText[color], "border-foreground/30")
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <I className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={() => setAddCourseOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !code.trim()}>
            Create Course
          </button>
        </div>
      </form>
    </Modal>
  );
}
