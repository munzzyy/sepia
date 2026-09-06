// Spanish catalog. Keys are normalized English source strings; run
// tools/extract-strings.mjs to see what is missing or stale.

export const es = {
  "Skip to content": "Saltar al contenido",
  "Share images without oversharing.": "Comparte imágenes sin compartir de más.",
  "Photos and screenshots say more than you think: where you were, what phone you own, sometimes a hidden copy of the uncropped shot. Sepia shows you all of it, blacks out what you choose, and hands back a file it has re-checked itself.":
    "Las fotos y capturas dicen más de lo que crees: dónde estabas, qué teléfono tienes, a veces hasta una copia oculta de la toma sin recortar. Sepia te muestra todo, tapa lo que elijas y te devuelve un archivo que él mismo volvió a revisar.",
  "Choose an image": "Elige una imagen",
  "or drop one here, or paste with Ctrl+V": "o suelta una aquí, o pega con Ctrl+V",
  "or share a photo to Sepia from any app": "o comparte una foto a Sepia desde cualquier app",
  "Try it on a sample photo": "Pruébalo con una foto de ejemplo",
  "Everything happens on this device. Nothing is uploaded, ever.":
    "Todo ocurre en este dispositivo. Nunca se sube nada.",
  "What leaks when you share a picture": "Qué se filtra cuando compartes una imagen",
  "Where you were": "Dónde estabas",
  "Phone cameras write GPS coordinates into every shot. Forwarding a photo of your dog can hand over your home address to whoever downloads it.":
    "Las cámaras del teléfono escriben coordenadas GPS en cada toma. Reenviar una foto de tu perro puede entregar la dirección de tu casa a quien la descargue.",
  "Who and what took it": "Quién y con qué la tomó",
  "Camera serial numbers, owner name fields, editing software, timestamps down to the second and time zone. Enough to tie separate photos to one person.":
    "Números de serie de la cámara, campos con el nombre del dueño, software de edición, marcas de tiempo al segundo y zona horaria. Suficiente para vincular fotos distintas a una misma persona.",
  "A hidden second image": "Una segunda imagen oculta",
  "Many files carry a small preview copy inside. Crop something embarrassing out, and the preview can still show the full original.":
    "Muchos archivos llevan dentro una copia pequeña de vista previa. Recortas algo comprometedor y la vista previa puede seguir mostrando el original completo.",
  "A hidden video": "Un video oculto",
  "Motion photo modes append a short video clip after the image data. It travels with the file, invisible in every normal viewer.":
    "Los modos de foto en movimiento añaden un clip corto de video después de la imagen. Viaja con el archivo, invisible en cualquier visor normal.",
  "Bad redactions": "Redacciones mal hechas",
  "Highlighter smears and crops done in the wrong app leave the covered text recoverable. Sepia burns redactions into the pixels and re-encodes everything.":
    "Los tachones de marcador y los recortes hechos en la app equivocada dejan el texto recuperable. Sepia quema las coberturas en los píxeles y recodifica todo.",
  "Codes you forgot about": "Códigos que olvidaste",
  "Boarding passes, tickets, parcel labels. The QR code in your screenshot holds more than the text next to it. Sepia finds codes and offers to cover them.":
    "Pases de abordar, boletos, etiquetas de paquetes. El código QR de tu captura guarda más que el texto de al lado. Sepia encuentra los códigos y ofrece taparlos.",
  "It shows its work": "Muestra su trabajo",
  "Every scrubber promises a clean file. Sepia re-opens the finished file and runs the same X-ray on it that it ran on the original, then shows you the result. If anything survived, you would see it listed, not a green checkmark on faith.":
    "Todo limpiador promete un archivo limpio. Sepia vuelve a abrir el archivo terminado y le pasa la misma radiografía que al original, y te enseña el resultado. Si algo sobreviviera, lo verías en la lista, no una palomita verde por fe.",
  "What Sepia does not do": "Lo que Sepia no hace",
  "It cannot read minds about pixels. A face, a street sign, or a reflection in a window is content, and covering it is your call. Sepia gives you the tools and flags QR codes, nothing more.":
    "No adivina qué hay en los píxeles. Una cara, un letrero o un reflejo en una ventana son contenido, y taparlos es tu decisión. Sepia te da las herramientas y señala códigos QR, nada más.",
  "Pixelation on text is weaker than ink. Research keeps un-blurring blurred text. For words and numbers, use the ink tool; pixelate is for faces and objects.":
    "Pixelar texto es más débil que la tinta. La investigación sigue logrando revertir texto difuminado. Para palabras y números usa la tinta; pixelar es para caras y objetos.",
  "No PDFs. Half-done PDF redaction has burned people badly, and pretending to handle it would be worse than not handling it.":
    "Nada de PDF. Las redacciones de PDF a medias han quemado feo a mucha gente, y fingir que lo manejamos sería peor que no manejarlo.",
  "A camera's sensor leaves a faint fingerprint in the pixels themselves. Removing metadata does not remove that. If your threat is a forensics lab, you need more than any scrubber.":
    "El sensor de una cámara deja una huella tenue en los propios píxeles. Quitar los metadatos no quita eso. Si tu amenaza es un laboratorio forense, necesitas más que cualquier limpiador.",
  "The Android app cannot phone home": "La app de Android no puede llamar a casa",
  'The Sepia app ships without the internet permission. Not "we promise not to upload", the operating system will not let it open a connection at all. Check the manifest yourself.':
    'La app de Sepia viene sin el permiso de internet. No es un "prometemos no subir nada": el sistema operativo no la deja abrir conexiones, punto. Revisa el manifiesto tú mismo.',
  "Download the APK": "Descargar el APK",
  "Or use the web app right here. It works offline once loaded and can be installed from your browser menu.":
    "O usa la app web aquí mismo. Funciona sin conexión una vez cargada y se puede instalar desde el menú del navegador.",
  "Questions people ask": "Preguntas que hace la gente",
  "Is my image uploaded to a server?": "¿Mi imagen se sube a un servidor?",
  "No. There is no server to upload to. The page never opens a connection except to fetch its own code from this site, and the Android app cannot open connections at all.":
    "No. No hay servidor al que subirla. La página solo abre conexiones para traer su propio código de este sitio, y la app de Android no puede abrir conexiones en absoluto.",
  "Why not just screenshot the photo?": "¿Por qué no simplemente capturar la pantalla?",
  "A screenshot does drop the original metadata, but it also drops quality, keeps whatever was visible, and your screenshot tool may write its own timestamps and file names that say when and where you took it. Sepia keeps full quality, covers what you choose, and gives the file a name that says nothing.":
    "Una captura sí pierde los metadatos originales, pero también pierde calidad, conserva todo lo visible, y tu herramienta de capturas puede escribir sus propias marcas de tiempo y nombres de archivo que dicen cuándo y dónde la tomaste. Sepia conserva la calidad completa, tapa lo que elijas y le da al archivo un nombre que no dice nada.",
  "What happens to the hidden video in motion photos?": "¿Qué pasa con el video oculto de las fotos en movimiento?",
  "Re-encoding keeps only the pixels you see, so the appended clip is gone from the output. The X-ray warns you it was there, so you know what the original still carries.":
    "La recodificación conserva solo los píxeles que ves, así que el clip añadido desaparece del resultado. La radiografía te avisa que estaba ahí, para que sepas qué sigue cargando el original.",
  "Can I keep my copyright line in the file?": "¿Puedo conservar mi línea de copyright en el archivo?",
  "Not yet. The first version strips everything; a keep-my-credit option is on the list.":
    "Todavía no. La primera versión quita todo; una opción de conservar tu crédito está en la lista.",
  "Is this open source?": "¿Es de código abierto?",
  "Yes, MIT licensed. The whole app is readable JavaScript with no dependencies.":
    "Sí, con licencia MIT. Toda la app es JavaScript legible y sin dependencias.",
  "Privacy": "Privacidad",
  "About Sepia": "Acerca de Sepia",

  "Close this image": "Cerrar esta imagen",
  "Undo": "Deshacer",
  "Redo": "Rehacer",
  "X-ray": "Radiografía",
  "Image editor canvas. Press B to add a cover box, arrow keys to move it, Shift and arrows to resize, Delete to remove.":
    "Lienzo del editor de imagen. Pulsa B para añadir un recuadro de cobertura, flechas para moverlo, Shift y flechas para cambiar su tamaño, Suprimir para quitarlo.",
  "Drag to choose what to keep": "Arrastra para elegir qué conservar",
  "Apply crop": "Aplicar recorte",
  "Cancel": "Cancelar",
  "Redaction tools": "Herramientas de redacción",
  "Ink": "Tinta",
  "Pixelate": "Pixelar",
  "Crop": "Recortar",
  "Find codes": "Buscar códigos",
  "Scrub & export": "Limpiar y exportar",
  "Pixelate is for faces and objects. For text or numbers, ink is the safe tool: pixelated text can sometimes be reconstructed.":
    "Pixelar es para caras y objetos. Para texto o números la herramienta segura es la tinta: el texto pixelado a veces se puede reconstruir.",
  "What this file says": "Lo que dice este archivo",
  "Close X-ray": "Cerrar radiografía",
  "The hidden preview stored inside this file:": "La vista previa oculta guardada dentro de este archivo:",
  "All of this disappears when you export. Redactions handle what is visible in the pixels.":
    "Todo esto desaparece al exportar. Las redacciones se encargan de lo visible en los píxeles.",

  "Checked clean": "Verificado limpio",
  "Something survived": "Algo sobrevivió",
  "Removed from this file": "Eliminado de este archivo",
  "Still in the file": "Todavía en el archivo",
  "Quality": "Calidad",
  "Share": "Compartir",
  "Save": "Guardar",
  "Scrub another image": "Limpiar otra imagen",

  "Could not read this file's structure. Re-encoding will still strip whatever is in it.":
    "No se pudo leer la estructura de este archivo. La recodificación quitará igual lo que lleve dentro.",
  "This image says exactly where it was taken.": "Esta imagen dice exactamente dónde se tomó.",
  "This file carries hidden data after the image ends.": "Este archivo lleva datos ocultos después de donde termina la imagen.",
  "This file hides a second preview image inside.": "Este archivo esconde una segunda imagen de vista previa.",
  "This image identifies you.": "Esta imagen te identifica.",
  "This image narrows down when and how it was made.": "Esta imagen acota cuándo y cómo se hizo.",
  "No personal metadata found. The pixels themselves are on you.":
    "No se encontraron metadatos personales. Los píxeles en sí corren por tu cuenta.",
  "serious": "grave",
  "revealing": "revelador",
  "harmless": "inofensivo",

  "{count} serious leaks in this file": "{count} filtraciones graves en este archivo",
  "{count} revealing details in this file": "{count} detalles reveladores en este archivo",
  "No metadata leaks found": "Sin filtraciones de metadatos",
  "Nothing found beyond the pixels themselves.": "No se encontró nada más allá de los propios píxeles.",
  "Copy": "Copiar",
  "Show": "Mostrar",
  "The hidden preview image found inside the file": "La imagen de vista previa oculta encontrada dentro del archivo",
  "Coordinates copied": "Coordenadas copiadas",

  "The exported file was re-opened and re-scanned. Nothing above harmless technical detail remains.":
    "El archivo exportado se volvió a abrir y a escanear. No queda nada por encima de detalle técnico inofensivo.",
  "The exported file was re-scanned and something is still in it. Details below.":
    "El archivo exportado se volvió a escanear y algo sigue dentro. Detalles abajo.",
  "Preview of the scrubbed image": "Vista previa de la imagen limpia",
  "{count} technical fields": "{count} campos técnicos",
  "{count} area(s) permanently covered": "{count} zona(s) cubiertas permanentemente",
  "Everything outside the crop": "Todo lo que quedó fuera del recorte",
  "Nothing needed removing; the file was re-encoded anyway.":
    "No hacía falta quitar nada; el archivo se recodificó de todos modos.",
  "Saved as {name}. The original name ({orig}) stays with the original.":
    "Guardado como {name}. El nombre original ({orig}) se queda con el original.",
  "Saved as {name}.": "Guardado como {name}.",

  "Could not open this image. HEIC and RAW files need converting first; sharing from your gallery usually converts automatically.":
    "No se pudo abrir esta imagen. Los archivos HEIC y RAW necesitan convertirse primero; compartir desde tu galería suele convertirlos automáticamente.",
  "That does not look like an image.": "Eso no parece una imagen.",
  "A sample photo with everything wrong with it. Open the X-ray.":
    "Una foto de ejemplo con todo lo que puede salir mal. Abre la radiografía.",
  "The sample image is missing.": "Falta la imagen de ejemplo.",
  "Could not read the shared image.": "No se pudo leer la imagen compartida.",
  "{count} scannable code(s) found. Tap the outline to cover one.":
    "{count} código(s) escaneables encontrados. Toca el contorno para tapar uno.",
  "{count} scannable code(s) found and outlined on the image.":
    "{count} código(s) escaneables encontrados y marcados en la imagen.",
  "{count} serious leaks found. The X-ray panel lists them.":
    "{count} filtraciones graves encontradas. El panel de radiografía las enumera.",
  "Code covered with ink": "Código cubierto con tinta",
  "{tool} box added": "Recuadro de {tool} añadido",
  "Box removed": "Recuadro quitado",
  "Cover box added at the center. Arrow keys move it, Shift and arrows resize, Delete removes.":
    "Recuadro de cobertura añadido al centro. Las flechas lo mueven, Shift y flechas cambian su tamaño, Suprimir lo quita.",
  "Crop applied. Everything outside the bright area will be removed on export.":
    "Recorte aplicado. Todo lo que quede fuera de la zona clara se eliminará al exportar.",
  "Drag across the image first to choose what to keep.":
    "Primero arrastra sobre la imagen para elegir qué conservar.",
  "Your covers are not exported yet. Tap close again to discard them.":
    "Tus coberturas aún no se exportan. Toca cerrar otra vez para descartarlas.",
  "Sharing is not available here, so it downloaded instead.":
    "Compartir no está disponible aquí, así que se descargó en su lugar.",
  "Saved to your photos": "Guardado en tus fotos",
  "Downloaded": "Descargado",
  "Next image ({count} left)": "Siguiente imagen (quedan {count})",
};
