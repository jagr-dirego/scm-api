# scm-api

Backend API de DIREGO SCM.

## Estado

Repositorio en desarrollo para el Sprint 3. La arquitectura aprobada define un monolito modular con NestJS y Fastify, API REST bajo `/api/v1`, PostgreSQL mediante Drizzle y despliegue controlado en Dokploy.

El bootstrap inicial ya incluye:

- NestJS sobre Fastify
- TypeScript y pnpm
- configuracion validada con Zod
- OpenAPI bajo `/api/v1/docs`
- endpoints de liveness y readiness
- pool PostgreSQL con cierre controlado y readiness real
- pruebas unitarias y de integracion con Vitest
- Argon2id, `PasswordService` y nucleo transaccional del bootstrap inicial
- login con email y password, bloqueo temporal y auditoria de eventos
- configuracion JWT RS256 validada y `TokenService` sin emision funcional en login

Todavia no incluye:

- JWT, refresh tokens y sesiones; corresponden a HU-28
- endpoints de importacion
- procesamiento asincrono

## PostgreSQL local de pruebas

La instancia local usa PostgreSQL 16.4, publica solamente en `127.0.0.1:15433` y mantiene un volumen separado de cualquier entorno de Dokploy.

```powershell
pnpm.cmd db:test:up
$env:TEST_DATABASE_URL='postgresql://scm_test:scm_test_password@127.0.0.1:15433/scm_test'
pnpm.cmd test:integration
```

La migracion y los seeds pertenecen a `scm-database`. Para preparar una instancia nueva, se aplica la migracion desde ese repositorio usando la URL local y luego los seeds aprobados en orden. Nunca se debe usar `DATABASE_URL` de Dokploy para pruebas.

Comandos operativos:

```powershell
pnpm.cmd db:test:logs
pnpm.cmd db:test:down
```

`db:test:down` conserva el volumen. La eliminacion del volumen debe ser una accion manual y deliberada.

## Bootstrap administrativo inicial

El comando se ejecuta exclusivamente en una terminal interactiva y no inicia el servidor HTTP:

```powershell
pnpm.cmd bootstrap:admin
```

Solicita organizacion, email, nombre y password con confirmacion oculta. Antes de escribir exige teclear `CREAR`. No acepta argumentos, redireccion de entrada, password mediante variables ni ejecucion automatica. Debe apuntar deliberadamente a la base objetivo mediante `DATABASE_URL`; las pruebas automatizadas nunca deben usar Dokploy.

La segunda ejecucion se rechaza si ya existe una asignacion global activa de `SuperAdmin`. No existe opcion `--force`.

## Login sin sesion

`POST /api/v1/auth/login` valida email, password y, cuando aplica, `organizationCode`. Todos los fallos de identidad o estado responden `401` con el mismo contrato para evitar enumeracion de usuarios. El exito devuelve unicamente IDs de usuario, organizacion y membresia, email y nombre visible.

Este endpoint todavia no emite JWT, refresh token ni crea registros en `sessions`. Esa continuidad pertenece a HU-28.

La base criptografica de HU-28 utiliza `jose`, claves RSA 3072, `kid`, issuer, audience y access tokens de 10 minutos. Las claves se reciben como Base64 mediante secretos de entorno; no existen claves por defecto ni material criptografico versionado.

Para generar o rotar exclusivamente las claves del entorno local:

```powershell
pnpm.cmd security:jwt:generate-local
```

El comando actualiza `.env` sin imprimir claves, se niega a operar si detecta `NODE_ENV=production` y no crea respaldos con secretos.

El nucleo de sesiones ya soporta creacion, rotacion de refresh token, expiracion, deteccion de reuso y revocacion compensatoria. Todavia no esta conectado al controlador de login ni emite cookies HTTP.

## Reglas de repositorio

- `main` es la rama protegida de integracion.
- Los cambios funcionales deben llegar mediante Pull Request.
- No se versionan secretos ni archivos `.env` reales.
- Las migraciones pertenecen exclusivamente a `scm-database`.
- Las pruebas nunca deben utilizar la base PostgreSQL de Dokploy.

## Repositorios relacionados

- `scm-docs`: documentacion, backlog y decisiones.
- `scm-database`: schema Drizzle, migraciones y seeds.
- `scm-api`: backend y API de negocio.
