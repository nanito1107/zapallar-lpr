Zapallar LPR

Reconocimiento de matrículas sobre Avigilon ACC. Dos piezas:

middleware/ — recibe el webhook de ACC con la matrícula y el ROI, y expone la cola de fotos pendientes. Node + Express + MySQL.
snapshot-agent/ — pregunta qué fotos faltan, las descarga de las cámaras y las devuelve recortadas. Node + axios + Jimp.
De dónde salió este repositorio
Este código no estaba versionado en ningún sitio. Vivía solo dentro de dos imágenes de contenedor del registro local, y el despliegue del snapshot-agent se mantenía a 0 réplicas precisamente para conservarlo. Rescatado el 2026-08-03 con docker create + docker cp sobre las imágenes.

Ninguna credencial va en el código: todo sale de process.env.

Cómo obtenía las imágenes
El detalle que importa está en snapshot-agent/wep-session.js.

Token propio de Avigilon, armado a mano:

sha256(timestamp + userKey)  ->  userNonce:timestamp:hash
Con eso, POST /mt/api/rest/v1/login devuelve una sesión de 1 hora. Se renueva a los 50 minutos, y ante un 403 se re-loguea y reintenta una vez.

El fotograma exacto del evento, no el vídeo en vivo:

GET /mt/api/rest/v1/media?cameraId=...&format=jpeg&t=<timestamp>
El parámetro t es lo que hace que recupere el instante de la detección.

Recorte con el ROI (image-crop.js): las coordenadas del evento vienen normalizadas (0-1); se pasan a píxeles, se añade un 10% de padding para dar contexto a la placa, y hay un fallback a la mitad inferior si el ROI llega fuera de rango. Jimp, JavaScript puro, sin dependencias nativas.

Por qué la base de datos creció a 53 GB
Se guardaban dos imágenes en base64 por cada detección --el recorte y el fotograma completo-- en dos columnas mediumtext de lpr_found. Unos 280 KB por fila. Con 222.681 filas, 53 GB.

Los datos se vaciaron el 2026-08-02 (no se necesitaban). Si esto se reactiva, la decisión pendiente es si hacen falta las fotos o basta con matrícula y hora.# -zapallar-lpr
