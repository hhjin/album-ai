\c album;

CREATE TABLE file_album
(
    f_id         BIGSERIAL PRIMARY KEY,
    file_name    VARCHAR(255),
    path         text,
    crc          VARCHAR(64),
    status       VARCHAR(32),
    content_type varchar(64),
    size         integer,
    desc_ai      text,
    desc_custom  text,
    extra        text,
    exif         jsonb,
    photo_time   TIMESTAMP WITH TIME ZONE

);

create unique index uk_crc on file_album (crc);

CREATE EXTENSION vector;
CREATE EXTENSION postgis;
create table file_vector_index
(
    id        bigserial primary key,
    text      varchar not null,
    metadata  jsonb,
    embedding vector(1536)
);

