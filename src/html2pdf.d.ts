declare module "html2pdf.js" {
  export interface Html2PdfOptions {
    margin?: number | [number, number, number, number];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: { scale?: number; useCORS?: boolean; logging?: boolean };
    jsPDF?: { unit?: string; format?: string | [number, number]; orientation?: string };
    pagebreak?: { mode?: string | string[]; before?: string; after?: string; avoid?: string };
  }

  interface Html2PdfChain {
    set(options: Html2PdfOptions): Html2PdfChain;
    from(element: HTMLElement): Html2PdfChain;
    save(): Promise<void>;
  }

  function html2pdf(): Html2PdfChain;
  export default html2pdf;
}
