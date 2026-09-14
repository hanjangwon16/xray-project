import '@kitware/vtk.js/Rendering/Profiles/All';

import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageResliceMapper from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkAppendPolyData from '@kitware/vtk.js/Filters/General/AppendPolyData';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import type { Volume } from './volume';
import type { ViewName, BeamGeometry } from './types';

export function buildImageData(v: Volume) {
  const imageData = vtkImageData.newInstance({
    origin: v.meta.origin,
    spacing: v.meta.spacing,
    direction: v.meta.direction.flat(),
  });
  imageData.setDimensions(v.meta.dims);
  const scalars = vtkDataArray.newInstance({
    name: 'HU',
    values: v.data,
    numberOfComponents: 1,
  });
  imageData.getPointData().setScalars(scalars);
  return imageData;
}

export function buildLabelData(v: Volume) {
  if (!v.labels) return null;
  const imageData = vtkImageData.newInstance({
    origin: v.meta.origin,
    spacing: v.meta.spacing,
    direction: v.meta.direction.flat(),
  });
  imageData.setDimensions(v.meta.dims);
  const scalars = vtkDataArray.newInstance({
    name: 'LABEL',
    values: v.labels,
    numberOfComponents: 1,
  });
  imageData.getPointData().setScalars(scalars);
  return imageData;
}

export interface SliceView {
  container: HTMLDivElement;
  grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>;
  mapper: ReturnType<typeof vtkImageResliceMapper.newInstance>;
  plane: ReturnType<typeof vtkPlane.newInstance>;
  actor: ReturnType<typeof vtkImageSlice.newInstance>;
  crosshair: { setPoint1: (x:number,y:number,z:number)=>void; setPoint2: (x:number,y:number,z:number)=>void; modified: ()=>void }[];
  view: ViewName;
}

const VIEW_NORMALS: Record<ViewName, [number, number, number]> = {
  axial: [0, 0, 1],
  coronal: [0, -1, 0],
  sagittal: [1, 0, 0],
};

export function createSliceView(
  parent: HTMLElement,
  imageData: ReturnType<typeof buildImageData>,
  view: ViewName,
): SliceView {
  const container = document.createElement('div');
  container.className = 'vp';
  parent.appendChild(container);
  const grw = vtkGenericRenderWindow.newInstance({ listenWindowResize: false });
  grw.setContainer(container);
  grw.resize();

  const mapper = vtkImageResliceMapper.newInstance();
  mapper.setInputData(imageData);
  const plane = vtkPlane.newInstance({
    normal: VIEW_NORMALS[view],
    origin: [0, 0, 0],
  });
  mapper.setSlicePlane(plane);

  const actor = vtkImageSlice.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColorWindow(2307);
  actor.getProperty().setColorLevel(53);

  const renderer = grw.getRenderer();
  renderer.addActor(actor);
  renderer.setBackground(0.05, 0.05, 0.07);

  const camera = renderer.getActiveCamera();
  camera.setParallelProjection(true);
  const n = VIEW_NORMALS[view];
  const b = imageData.getBounds();
  const c: [number, number, number] = [
    (b[0] + b[1]) / 2,
    (b[2] + b[3]) / 2,
    (b[4] + b[5]) / 2,
  ];
  camera.setFocalPoint(c[0], c[1], c[2]);
  camera.setPosition(c[0] + n[0] * 500, c[1] + n[1] * 500, c[2] + n[2] * 500);
  if (view === 'axial') camera.setViewUp(0, -1, 0);
  else camera.setViewUp(0, 0, 1);
  renderer.resetCamera();

  const istyle = vtkInteractorStyleImage.newInstance();
  grw.getInteractor().setInteractorStyle(istyle);

  // crosshair lines (in-plane)
  const chColor: Record<ViewName, [number, number, number]> = {
    axial: [0.2, 0.9, 0.5], coronal: [0.95, 0.8, 0.2], sagittal: [0.5, 0.7, 1.0],
  };
  const crosshair: SliceView['crosshair'] = [];
  for (let li = 0; li < 2; li++) {
    const ln = vtkLineSource.newInstance();
    const lm = vtkMapper.newInstance();
    lm.setInputConnection(ln.getOutputPort());
    const la = vtkActor.newInstance();
    la.setMapper(lm);
    la.getProperty().setColor(...chColor[view]);
    la.getProperty().setOpacity(0.75);
    la.getProperty().setLineWidth(1.5);
    renderer.addActor(la);
    crosshair.push(ln as unknown as SliceView['crosshair'][0]);
  }

  return { container, grw, mapper, plane, actor, crosshair, view };
}

// Update crosshair lines on a slice view to intersect at world point.
export function updateCrosshair(sv: SliceView, world: [number, number, number], bounds: number[]) {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const [x, y, z] = world;
  const e = 0.5;
  let lines: [number[], number[]][] = [];
  if (sv.view === 'axial') {
    lines = [
      [[xmin, y, z + e], [xmax, y, z + e]],
      [[x, ymin, z + e], [x, ymax, z + e]],
    ];
  } else if (sv.view === 'coronal') {
    lines = [
      [[xmin, y + e, z], [xmax, y + e, z]],
      [[x, y + e, zmin], [x, y + e, zmax]],
    ];
  } else {
    lines = [
      [[x + e, ymin, z], [x + e, ymax, z]],
      [[x + e, y, zmin], [x + e, y, zmax]],
    ];
  }
  for (let i = 0; i < 2; i++) {
    sv.crosshair[i].setPoint1(lines[i][0][0], lines[i][0][1], lines[i][0][2]);
    sv.crosshair[i].setPoint2(lines[i][1][0], lines[i][1][1], lines[i][1][2]);
    sv.crosshair[i].modified();
  }
}

export function setSliceWindow(sv: SliceView, w: number, l: number) {
  sv.actor.getProperty().setColorWindow(w);
  sv.actor.getProperty().setColorLevel(l);
  sv.grw.getRenderWindow().render();
}

export function setSlicePosition(sv: SliceView, world: [number, number, number]) {
  sv.plane.setOrigin(world);
  sv.plane.modified();
  sv.mapper.modified();
  sv.grw.getRenderWindow().render();
}

export interface VolumeView {
  container: HTMLDivElement;
  grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>;
  beamActors: ReturnType<typeof vtkActor.newInstance>[];
  renderer: ReturnType<ReturnType<typeof vtkGenericRenderWindow.newInstance>['getRenderer']>;
}

// Major structures to show as separate colored surfaces in 3D.
const SURFACE_LABELS: { id: number; name: string; color: [number, number, number]; opacity: number }[] = [
  { id: 52, name: '심장', color: [0.9, 0.25, 0.3], opacity: 0.85 },
  { id: 30, name: '우상엽', color: [0.55, 0.7, 0.95], opacity: 0.4 },
  { id: 31, name: '우중엽', color: [0.6, 0.75, 0.95], opacity: 0.4 },
  { id: 32, name: '우하엽', color: [0.5, 0.65, 0.92], opacity: 0.4 },
  { id: 33, name: '좌상엽', color: [0.55, 0.8, 0.9], opacity: 0.4 },
  { id: 7, name: '대동맥', color: [0.95, 0.3, 0.3], opacity: 0.8 },
  { id: 5, name: '간', color: [0.8, 0.5, 0.25], opacity: 0.7 },
  { id: 1, name: '비장', color: [0.85, 0.35, 0.35], opacity: 0.7 },
];

export function createVolumeView(
  parent: HTMLElement,
  imageData: ReturnType<typeof buildImageData>,
  labelData: ReturnType<typeof buildLabelData>,
): VolumeView {
  const container = document.createElement('div');
  container.className = 'vp';
  parent.appendChild(container);
  const grw = vtkGenericRenderWindow.newInstance({ listenWindowResize: false });
  grw.setContainer(container);
  grw.resize();

  const mc = vtkImageMarchingCubes.newInstance({ contourValue: 300, computeNormals: true, mergePoints: true });
  mc.setInputData(imageData);
  const mapper = vtkMapper.newInstance();
  mapper.setInputConnection(mc.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(0.85, 0.82, 0.75);
  actor.getProperty().setOpacity(0.18);

  const renderer = grw.getRenderer();
  renderer.addActor(actor);
  renderer.setBackground(0.08, 0.09, 0.12);

  // per-structure colored surfaces from labelmap
  if (labelData) {
    for (const s of SURFACE_LABELS) {
      const smc = vtkImageMarchingCubes.newInstance({ contourValue: s.id - 0.5, computeNormals: true, mergePoints: true });
      smc.setInputData(labelData);
      const smap = vtkMapper.newInstance();
      smap.setInputConnection(smc.getOutputPort());
      const sact = vtkActor.newInstance();
      sact.setMapper(smap);
      sact.getProperty().setColor(s.color[0], s.color[1], s.color[2]);
      sact.getProperty().setOpacity(s.opacity);
      renderer.addActor(sact);
    }
  }
  renderer.resetCamera();
  // keep camera framed on the anatomy, not the beam geometry
  const b = imageData.getBounds();
  const c: [number, number, number] = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
  const cam = renderer.getActiveCamera();
  cam.setFocalPoint(c[0], c[1], c[2]);
  cam.setPosition(c[0] + 300, c[1] - 420, c[2] + 220);
  cam.setViewUp(0, 0, 1);
  renderer.resetCameraClippingRange();

  grw.getInteractor().setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());
  return { container, grw, beamActors: [], renderer };
}

// Build / refresh beam visualization actors inside the 3D view.
export function updateBeam(vv: VolumeView, beam: BeamGeometry, center: [number, number, number]) {
  const { renderer, beamActors } = vv;
  for (const a of beamActors) renderer.removeActor(a);
  beamActors.length = 0;

  // world center offset (beam coords are centered on volume center)
  const off = (p: [number, number, number]): [number, number, number] => [
    p[0] + center[0], p[1] + center[1], p[2] + center[2],
  ];

  // source sphere
  const srcPos = off(beam.src);
  const sph = vtkSphereSource.newInstance({ radius: 6, thetaResolution: 16, phiResolution: 16 });
  sph.setCenter(srcPos);
  const sphMap = vtkMapper.newInstance();
  sphMap.setInputConnection(sph.getOutputPort());
  const sphAct = vtkActor.newInstance();
  sphAct.setMapper(sphMap);
  sphAct.getProperty().setColor(1.0, 0.85, 0.2);
  renderer.addActor(sphAct);
  beamActors.push(sphAct);

  // detector plane
  const detC = off(beam.detC);
  const h = beam.detHalf;
  const u = beam.u, v = beam.v;
  const corner = (su: number, sv: number): [number, number, number] => [
    detC[0] + u[0] * h * su + v[0] * h * sv,
    detC[1] + u[1] * h * su + v[1] * h * sv,
    detC[2] + u[2] * h * su + v[2] * h * sv,
  ];
  const pl = vtkPlaneSource.newInstance();
  pl.setOrigin(corner(-1, -1));
  pl.setPoint1(corner(1, -1));
  pl.setPoint2(corner(-1, 1));
  const plMap = vtkMapper.newInstance();
  plMap.setInputConnection(pl.getOutputPort());
  const plAct = vtkActor.newInstance();
  plAct.setMapper(plMap);
  plAct.getProperty().setColor(0.3, 0.7, 1.0);
  plAct.getProperty().setOpacity(0.18);
  plAct.getProperty().setRepresentationToWireframe();
  renderer.addActor(plAct);
  beamActors.push(plAct);

  // cone edges: source -> 4 detector corners
  const append = vtkAppendPolyData.newInstance();
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [su, sv] of corners) {
    const ln = vtkLineSource.newInstance();
    ln.setPoint1(srcPos[0], srcPos[1], srcPos[2]);
    const cp = corner(su, sv);
    ln.setPoint2(cp[0], cp[1], cp[2]);
    ln.setResolution(1);
    append.addInputConnection(ln.getOutputPort());
  }
  const lnMap = vtkMapper.newInstance();
  lnMap.setInputConnection(append.getOutputPort());
  const lnAct = vtkActor.newInstance();
  lnAct.setMapper(lnMap);
  lnAct.getProperty().setColor(1.0, 0.6, 0.1);
  lnAct.getProperty().setOpacity(0.5);
  renderer.addActor(lnAct);
  beamActors.push(lnAct);

  vv.grw.getRenderWindow().render();
}
