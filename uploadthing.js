import { createUploadthing } from "uploadthing/express";

const f = createUploadthing({
  errorFormatter: (err) => {
    console.error("Upload error:", err);
    return { message: err.message };
  },
});

export const uploadRouter = {
  fileUploader: f({
    // Allow all file types with attachment content-disposition to force download
    image: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
    video: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
    audio: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
    pdf: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
    text: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
    blob: {
      maxFileSize: "100MB",
      maxFileCount: 10,
      contentDisposition: "attachment",
    },
  })
    .middleware(async ({ req, res }) => {
      // Add any authentication or metadata here
      return {};
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("Upload completed:", file.name, file.ufsUrl);
      return { success: true };
    }),
};
