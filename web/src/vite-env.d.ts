/// <reference types="vite/client" />

declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  import type { vtkAlgorithm } from '@kitware/vtk.js/interfaces';
  export interface vtkImageMarchingCubes extends vtkAlgorithm {
    setContourValue(v: number): boolean;
    setComputeNormals(v: boolean): boolean;
    setMergePoints(v: boolean): boolean;
  }
  export function newInstance(init?: {
    contourValue?: number;
    computeNormals?: boolean;
    mergePoints?: boolean;
  }): vtkImageMarchingCubes;
  export default { newInstance };
}
