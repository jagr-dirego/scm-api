# AGENTS.md

## Proyecto

Backend REST de DIREGO SCM. Usa Node.js, TypeScript, NestJS con Fastify,
PostgreSQL, Drizzle, Zod y Vitest. La API se publica bajo `/api/v1`.

## Responsabilidad

- Este repositorio contiene la API, autenticacion, sesiones, autorizacion,
  auditoria y logica de aplicacion.
- El schema y las migraciones pertenecen a `@jagr-dirego/scm-database`.
- No crear ni ejecutar migraciones desde la API.

## Reglas De Trabajo

- Trabajar solo sobre la HU, modulo y archivos solicitados.
- Leer primero el archivo afectado, sus dependencias directas y sus pruebas.
- Expandir la busqueda solo cuando sea necesario.
- Aplicar el cambio minimo correcto; no hacer refactors ni mejoras adicionales.
- No agregar o actualizar dependencias sin una necesidad aprobada.
- Mantener separacion por modulos, inyeccion de dependencias y contratos Zod.
- No exponer passwords, tokens, cookies, secretos ni detalles internos en logs.
- Respetar RBAC, multi-organizacion y aislamiento de datos existentes.
- No modificar `scm-database` ni `scm-docs` salvo solicitud explicita.
- No crear commits salvo instruccion explicita.

## Validacion

- Durante el desarrollo, ejecutar primero la prueba especifica y lint relacionado.
- Al cerrar una HU, ejecutar pruebas del modulo, lint y build.
- Reservar la suite completa y CI para integracion o cuando se solicite.
- Detenerse cuando el alcance y las validaciones necesarias esten completos.

## Entrega

Reportar brevemente archivos modificados, cambio realizado, validaciones y
pendientes reales.
