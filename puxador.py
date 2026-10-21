import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from tqdm import tqdm

try:
    import torch
    from transformers import CLIPModel, CLIPProcessor
    import imagehash
except ImportError as e:
    print(f"[ERRO] Dependência ausente: {e}")
    print("Instale com:")
    print("pip install torch torchvision transformers pillow numpy tqdm imagehash")
    sys.exit(1)


EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".webp",
    ".tif", ".tiff", ".jfif", ".avif"
}

INDEX_NAME = ".image_search_index.npz"
MODEL_NAME = "openai/clip-vit-base-patch32"


def get_images(folder):
    print(f"[1/6] Procurando imagens em:")
    print(f"      {folder}")

    files = sorted(
        p for p in Path(folder).rglob("*")
        if p.is_file() and p.suffix.lower() in EXTENSIONS
    )

    print(f"      Encontradas: {len(files):,} imagens")
    return files


def file_signature(files):
    h = hashlib.sha256()

    for p in files:
        try:
            st = p.stat()
            h.update(str(p).encode("utf-8", errors="ignore"))
            h.update(str(st.st_size).encode())
            h.update(str(st.st_mtime_ns).encode())
        except OSError:
            pass

    return h.hexdigest()


def load_image(path):
    try:
        with Image.open(path) as im:
            return ImageOps.exif_transpose(im).convert("RGB")
    except Exception:
        return None


def get_phash(path):
    image = load_image(path)

    if image is None:
        return None

    try:
        return imagehash.phash(image)
    except Exception:
        return None


def get_clip_embeddings(files, model, processor, device, batch_size=32):
    vectors = []
    valid_files = []

    total = len(files)

    for start in range(0, total, batch_size):
        batch_files = files[start:start + batch_size]

        images = []
        current_files = []

        for path in batch_files:
            image = load_image(path)

            if image is not None:
                images.append(image)
                current_files.append(str(path))

        if not images:
            continue

        inputs = processor(
            images=images,
            return_tensors="pt"
        )

        inputs = {
            key: value.to(device)
            for key, value in inputs.items()
        }

        with torch.no_grad():
            features = model.get_image_features(**inputs)

        if hasattr(features, "image_embeds") and features.image_embeds is not None:
            features = features.image_embeds
        elif hasattr(features, "pooler_output"):
            features = features.pooler_output
        elif isinstance(features, tuple):
            features = features[0]

        query = model.get_image_features(**inputs)

        if hasattr(query, "image_embeds") and query.image_embeds is not None:
            query = query.image_embeds
        elif hasattr(query, "pooler_output"):
            query = query.pooler_output
        elif isinstance(query, tuple):
            query = query[0]

        query = query / query.norm(
            dim=-1,
            keepdim=True
        )

        vectors.append(
            features.cpu().numpy().astype(np.float32)
        )

        valid_files.extend(current_files)

        done = min(start + len(batch_files), total)

        print(
            f"\r[3/6] Indexando: "
            f"{done:,}/{total:,}",
            end="",
            flush=True
        )

    print()

    if not vectors:
        return (
            np.empty((0, 512), dtype=np.float32),
            []
        )

    return np.concatenate(vectors), valid_files


def make_index(
    folder,
    files,
    model,
    processor,
    device,
    force=False
):
    index_path = Path(folder) / INDEX_NAME
    signature = file_signature(files)

    if index_path.exists() and not force:
        print("[2/6] Verificando índice existente...")

        try:
            data = np.load(
                index_path,
                allow_pickle=True
            )

            if str(data["signature"]) == signature:
                paths = data["paths"].tolist()

                print(
                    f"      Índice válido: "
                    f"{len(paths):,} imagens"
                )

                return data["vectors"], paths

        except Exception:
            pass

    print("[2/6] Índice inexistente ou desatualizado.")
    print("[3/6] Criando índice CLIP...")

    vectors, paths = get_clip_embeddings(
        files,
        model,
        processor,
        device
    )

    np.savez_compressed(
        index_path,
        vectors=vectors,
        paths=np.array(
            paths,
            dtype=object
        ),
        signature=signature
    )

    print()
    print(f"      Índice salvo em:")
    print(f"      {index_path}")

    return vectors, paths


def clip_search(
    query_path,
    vectors,
    paths,
    model,
    processor,
    device,
    top
):
    print("[4/6] Analisando a imagem de referência...")

    image = load_image(query_path)

    if image is None:
        raise RuntimeError(
            f"Não foi possível abrir: {query_path}"
        )

    inputs = processor(
        images=image,
        return_tensors="pt"
    )

    inputs = {
        key: value.to(device)
        for key, value in inputs.items()
    }

    with torch.no_grad():
        query = model.get_image_features(**inputs)

    if hasattr(query, "image_embeds") and query.image_embeds is not None:
        query = query.image_embeds
    elif hasattr(query, "pooler_output"):
        query = query.pooler_output
    elif isinstance(query, tuple):
        query = query[0]

    query = query / query.norm(
        dim=-1,
        keepdim=True
    )

    scores = vectors @ query.cpu().numpy()[0]

    indices = np.argsort(scores)[::-1][:top]

    return [
        (paths[i], float(scores[i]))
        for i in indices
    ]

def phash_search(query_path, paths, top):
    print("[5/6] Executando comparação pHash...")

    query_hash = get_phash(query_path)

    if query_hash is None:
        return []

    results = []

    for path in tqdm(
        paths,
        desc="      pHash",
        unit="img"
    ):
        image_hash = get_phash(path)

        if image_hash is not None:
            distance = query_hash - image_hash
            results.append(
                (path, distance)
            )

    results.sort(
        key=lambda x: x[1]
    )

    return results[:top]


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "imagem",
        help="Imagem/textura usada como referência"
    )

    parser.add_argument(
        "pasta",
        help="Pasta contendo as fotos"
    )

    parser.add_argument(
        "--top",
        type=int,
        default=30,
        help="Quantidade de resultados"
    )

    parser.add_argument(
        "--phash",
        action="store_true",
        help="Executa também a busca pHash"
    )

    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Força reconstrução do índice"
    )

    args = parser.parse_args()

    query = Path(args.imagem)
    folder = Path(args.pasta)

    if not query.is_file():
        print(
            f"[ERRO] Imagem não encontrada:"
            f"\n{query}"
        )
        sys.exit(1)

    if not folder.is_dir():
        print(
            f"[ERRO] Pasta não encontrada:"
            f"\n{folder}"
        )
        sys.exit(1)

    print("=" * 80)
    print("BUSCA DE IMAGEM")
    print("=" * 80)

    print(f"Imagem : {query}")
    print(f"Pasta  : {folder}")
    print(f"Top    : {args.top}")
    print()

    print("[0/6] Carregando CLIP...")

    device = (
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    print(f"      Dispositivo: {device}")

    processor = CLIPProcessor.from_pretrained(
        MODEL_NAME
    )

    model = CLIPModel.from_pretrained(
        MODEL_NAME
    ).to(device)

    model.eval()

    files = get_images(folder)

    if not files:
        print(
            "[ERRO] Nenhuma imagem encontrada."
        )
        sys.exit(1)

    index_path = folder / INDEX_NAME

    if args.reindex and index_path.exists():
        print("[INFO] Removendo índice antigo...")
        index_path.unlink()

    vectors, paths = make_index(
        folder,
        files,
        model,
        processor,
        device,
        args.reindex
    )

    if len(paths) == 0:
        print(
            "[ERRO] Nenhuma imagem válida foi indexada."
        )
        sys.exit(1)

    print("[6/6] Procurando imagens semelhantes...")

    results = clip_search(
        query,
        vectors,
        paths,
        model,
        processor,
        device,
        args.top
    )

    print()
    print("=" * 80)
    print(
        f"RESULTADOS CLIP — TOP {len(results)}"
    )
    print("=" * 80)

    for number, (path, score) in enumerate(
        results,
        1
    ):
        print(
            f"{number:3d}. "
            f"{score:.4f}  "
            f"{path}"
        )

    if args.phash:
        print()
        print("=" * 80)
        print(
            f"RESULTADOS pHASH — TOP {args.top}"
        )
        print("=" * 80)

        results_phash = phash_search(
            query,
            paths,
            args.top
        )

        for number, (path, distance) in enumerate(
            results_phash,
            1
        ):
            print(
                f"{number:3d}. "
                f"distância={distance:2d}  "
                f"{path}"
            )


if __name__ == "__main__":
    main()